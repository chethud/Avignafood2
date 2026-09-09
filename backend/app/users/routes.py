from datetime import datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.audit.service import write_audit
from app.core.database import get_db
from app.core.deps import AuthContext, require_perms
from app.core.models import Permission, Role, RoleName, User, UserCompany, UserPermission
from app.core.schemas import (
    PermissionOut,
    UserCreate,
    UserOut,
    UserPermissionGrant,
    UserPermissionOut,
    UserUpdate,
)
from app.core.security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


def _out(user: User) -> UserOut:
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


def _grant_out(g: UserPermission) -> UserPermissionOut:
    return UserPermissionOut(
        id=g.id,
        permission_code=g.permission.code,
        description=g.permission.description,
        forever=g.expires_at is None,
        expires_at=g.expires_at,
        created_at=g.created_at,
    )


def _org_user(db: Session, auth: AuthContext, user_id: int) -> User:
    user = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.companies))
        .filter(User.id == user_id, User.organization_id == auth.organization_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/permissions/catalog", response_model=list[PermissionOut])
def list_permission_catalog(
    auth: AuthContext = Depends(require_perms("users.view")),
    db: Session = Depends(get_db),
):
    return db.query(Permission).order_by(Permission.code).all()


@router.get("", response_model=list[UserOut])
def list_users(
    auth: AuthContext = Depends(require_perms("users.view")),
    db: Session = Depends(get_db),
):
    users = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.companies))
        .filter(User.organization_id == auth.organization_id)
        .all()
    )
    return [_out(u) for u in users]


@router.post("", response_model=UserOut)
def create_user(
    body: UserCreate,
    auth: AuthContext = Depends(require_perms("users.create")),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already exists")
    try:
        role_name = RoleName(body.role)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid role")
    if role_name == RoleName.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot create super admin")
    role = db.query(Role).filter(Role.name == role_name).first()
    if not role:
        raise HTTPException(status_code=400, detail="Role not found")
    user = User(
        organization_id=auth.organization_id,
        role_id=role.id,
        email=body.email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    db.flush()
    for cid in body.company_ids:
        db.add(UserCompany(user_id=user.id, company_id=cid))
    write_audit(
        db,
        action="create",
        entity_type="user",
        entity_id=user.id,
        organization_id=auth.organization_id,
        user_id=auth.user.id,
    )
    db.commit()
    user = _org_user(db, auth, user.id)
    return _out(user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UserUpdate,
    auth: AuthContext = Depends(require_perms("users.edit")),
    db: Session = Depends(get_db),
):
    user = _org_user(db, auth, user_id)
    if user.role.name == RoleName.SUPER_ADMIN and auth.role != RoleName.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Cannot edit super admin")
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password:
        user.hashed_password = hash_password(body.password)
    if body.role:
        try:
            role_name = RoleName(body.role)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid role")
        if role_name == RoleName.SUPER_ADMIN:
            raise HTTPException(status_code=400, detail="Cannot assign super admin")
        role = db.query(Role).filter(Role.name == role_name).first()
        if not role:
            raise HTTPException(status_code=400, detail="Role not found")
        user.role_id = role.id
    if body.company_ids is not None:
        db.query(UserCompany).filter(UserCompany.user_id == user.id).delete()
        for cid in body.company_ids:
            db.add(UserCompany(user_id=user.id, company_id=cid))
    write_audit(
        db,
        action="update",
        entity_type="user",
        entity_id=user.id,
        organization_id=auth.organization_id,
        user_id=auth.user.id,
    )
    db.commit()
    user = _org_user(db, auth, user_id)
    return _out(user)


@router.get("/{user_id}/permissions", response_model=list[UserPermissionOut])
def list_user_permissions(
    user_id: int,
    auth: AuthContext = Depends(require_perms("users.view")),
    db: Session = Depends(get_db),
):
    _org_user(db, auth, user_id)
    grants = (
        db.query(UserPermission)
        .options(joinedload(UserPermission.permission))
        .filter(UserPermission.user_id == user_id)
        .order_by(UserPermission.id.desc())
        .all()
    )
    return [_grant_out(g) for g in grants]


@router.post("/{user_id}/permissions", response_model=UserPermissionOut)
def attach_user_permission(
    user_id: int,
    body: UserPermissionGrant,
    auth: AuthContext = Depends(require_perms("users.edit")),
    db: Session = Depends(get_db),
):
    user = _org_user(db, auth, user_id)
    if user.role.name == RoleName.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Super admin already has all permissions")

    perm = db.query(Permission).filter(Permission.code == body.permission_code).first()
    if not perm:
        raise HTTPException(status_code=400, detail="Unknown permission")

    expires_at = None
    if not body.forever:
        if not body.expires_on:
            raise HTTPException(status_code=400, detail="expires_on required when not forever")
        expires_at = datetime.combine(body.expires_on, time(23, 59, 59), tzinfo=timezone.utc)

    existing = (
        db.query(UserPermission)
        .filter(UserPermission.user_id == user.id, UserPermission.permission_id == perm.id)
        .first()
    )
    if existing:
        existing.expires_at = expires_at
        existing.granted_by_id = auth.user.id
        grant = existing
    else:
        grant = UserPermission(
            user_id=user.id,
            permission_id=perm.id,
            expires_at=expires_at,
            granted_by_id=auth.user.id,
        )
        db.add(grant)

    write_audit(
        db,
        action="attach_permission",
        entity_type="user",
        entity_id=user.id,
        organization_id=auth.organization_id,
        user_id=auth.user.id,
        detail=f"{perm.code}; forever={expires_at is None}; until={expires_at}",
    )
    db.commit()
    grant = (
        db.query(UserPermission)
        .options(joinedload(UserPermission.permission))
        .filter(UserPermission.id == grant.id)
        .first()
    )
    return _grant_out(grant)


@router.delete("/{user_id}/permissions/{grant_id}", status_code=204)
def detach_user_permission(
    user_id: int,
    grant_id: int,
    auth: AuthContext = Depends(require_perms("users.edit")),
    db: Session = Depends(get_db),
):
    _org_user(db, auth, user_id)
    grant = (
        db.query(UserPermission)
        .options(joinedload(UserPermission.permission))
        .filter(UserPermission.id == grant_id, UserPermission.user_id == user_id)
        .first()
    )
    if not grant:
        raise HTTPException(status_code=404, detail="Grant not found")
    code = grant.permission.code
    db.delete(grant)
    write_audit(
        db,
        action="detach_permission",
        entity_type="user",
        entity_id=user_id,
        organization_id=auth.organization_id,
        user_id=auth.user.id,
        detail=code,
    )
    db.commit()
