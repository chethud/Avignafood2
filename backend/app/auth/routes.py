from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session, joinedload

from app.audit.service import write_audit
from app.core.database import engine, get_db
from app.core.deps import AuthContext, get_auth
from app.core.models import User
from app.core.schemas import MeOut, MeProfileUpdate, TokenOut, UserOut
from app.sales.ensure_schema import ensure_sales_schema
from app.core.security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

PHOTO_DIR = Path(__file__).resolve().parents[2] / "uploads" / "avatars"
PHOTO_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
PHOTO_MAX = 2 * 1024 * 1024


def _ensure_user_photo_column() -> None:
    insp = inspect(engine)
    if "users" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    if "photo_url" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN photo_url VARCHAR(255)"))


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        phone=user.phone,
        photo_url=getattr(user, "photo_url", None),
        organization_id=user.organization_id,
        role=user.role.name.value,
        is_active=user.is_active,
        company_ids=[uc.company_id for uc in user.companies],
    )


def _reload_me(db: Session, user_id: int, permissions: list[str]) -> MeOut:
    user = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.companies))
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return MeOut(user=_user_out(user), permissions=sorted(permissions))


@router.post("/login", response_model=TokenOut)
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.companies))
        .filter(User.email == form.username)
        .first()
    )
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive")
    token = create_access_token({"sub": str(user.id)})
    write_audit(
        db,
        action="login",
        entity_type="user",
        entity_id=user.id,
        organization_id=user.organization_id,
        user_id=user.id,
    )
    db.commit()
    return TokenOut(access_token=token)


@router.get("/me", response_model=MeOut)
def me(auth: AuthContext = Depends(get_auth)):
    _ensure_user_photo_column()
    return MeOut(user=_user_out(auth.user), permissions=sorted(auth.permissions))


@router.patch("/me", response_model=MeOut)
def update_me(
    body: MeProfileUpdate,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    ensure_sales_schema(engine)
    _ensure_user_photo_column()
    phone = (body.phone or "").strip() or None
    if phone and len(phone) > 30:
        raise HTTPException(status_code=400, detail="Mobile number is too long")
    name = (body.full_name or "").strip()
    if body.full_name is not None:
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        if len(name) > 120:
            raise HTTPException(status_code=400, detail="Name is too long")
    user = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.companies))
        .filter(User.id == auth.user.id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.full_name is not None:
        user.full_name = name
    user.phone = phone
    write_audit(
        db,
        action="update_profile",
        entity_type="user",
        entity_id=user.id,
        organization_id=user.organization_id,
        user_id=user.id,
        detail="name,phone",
    )
    db.commit()
    return _reload_me(db, auth.user.id, auth.permissions)


@router.post("/me/photo", response_model=MeOut)
async def upload_my_photo(
    file: UploadFile = File(...),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    _ensure_user_photo_column()
    ext = Path(file.filename or "").suffix.lower()
    if ext not in PHOTO_EXTS:
        raise HTTPException(status_code=400, detail="Use PNG, JPG, WEBP or GIF")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > PHOTO_MAX:
        raise HTTPException(status_code=400, detail="Photo max 2MB")

    user = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.companies))
        .filter(User.id == auth.user.id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    for old in PHOTO_DIR.glob(f"{user.id}.*"):
        old.unlink(missing_ok=True)
    dest = PHOTO_DIR / f"{user.id}{ext}"
    dest.write_bytes(data)
    user.photo_url = f"/uploads/avatars/{user.id}{ext}"
    write_audit(
        db,
        action="upload_photo",
        entity_type="user",
        entity_id=user.id,
        organization_id=user.organization_id,
        user_id=user.id,
    )
    db.commit()
    return _reload_me(db, auth.user.id, auth.permissions)


@router.delete("/me/photo", response_model=MeOut)
def remove_my_photo(
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    _ensure_user_photo_column()
    user = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.companies))
        .filter(User.id == auth.user.id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.photo_url:
        for old in PHOTO_DIR.glob(f"{user.id}.*"):
            old.unlink(missing_ok=True)
        user.photo_url = None
        write_audit(
            db,
            action="remove_photo",
            entity_type="user",
            entity_id=user.id,
            organization_id=user.organization_id,
            user_id=user.id,
        )
        db.commit()
    return _reload_me(db, auth.user.id, auth.permissions)
