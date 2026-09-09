from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.models import Permission, RoleName, RolePermission, User, UserPermission
from app.core.security import TokenError, safe_decode

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# These roles may omit X-Company-Id to see all companies in the org
ORG_WIDE_ROLES = {
    RoleName.SUPER_ADMIN,
    RoleName.OWNER,
    RoleName.ACCOUNTANT,
    RoleName.SUPERVISOR,
}


class AuthContext:
    def __init__(self, user: User, company_id: int | None, permissions: set[str]):
        self.user = user
        self.company_id = company_id
        self.permissions = permissions
        self.organization_id = user.organization_id

    @property
    def role(self) -> RoleName:
        return self.user.role.name

    def require_company(self) -> int:
        if self.company_id is None:
            raise HTTPException(
                status_code=400,
                detail="Pick a company first (not All companies) for this action",
            )
        return self.company_id

    def company_or_all(self) -> int | None:
        """None = all companies in the organisation (Owner / Accounts / Supervisor / Admin)."""
        if self.company_id is not None:
            return self.company_id
        if self.role in ORG_WIDE_ROLES:
            return None
        raise HTTPException(status_code=400, detail="X-Company-Id header required")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    try:
        payload = safe_decode(token)
    except TokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.companies))
        .filter(User.id == int(user_id), User.is_active.is_(True))
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def get_auth(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_company_id: str | None = Header(default=None, alias="X-Company-Id"),
) -> AuthContext:
    perms = (
        db.query(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == user.role_id)
        .all()
    )
    permission_set = {p[0] for p in perms}

    now = datetime.now(timezone.utc)
    extras = (
        db.query(Permission.code)
        .join(UserPermission, UserPermission.permission_id == Permission.id)
        .filter(
            UserPermission.user_id == user.id,
            or_(UserPermission.expires_at.is_(None), UserPermission.expires_at > now),
        )
        .all()
    )
    permission_set |= {p[0] for p in extras}

    company_id: int | None = None
    if x_company_id:
        try:
            company_id = int(x_company_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid X-Company-Id")
        from app.core.models import Company

        company = db.query(Company).filter(Company.id == company_id).first()
        if not company or company.organization_id != user.organization_id:
            raise HTTPException(status_code=403, detail="No access to this company")
        if user.role.name not in (
            RoleName.SUPER_ADMIN,
            RoleName.OWNER,
            RoleName.SALES,
            RoleName.ACCOUNTANT,
            RoleName.SUPERVISOR,
        ):
            allowed = {uc.company_id for uc in user.companies}
            if company_id not in allowed:
                raise HTTPException(status_code=403, detail="No access to this company")

    return AuthContext(user=user, company_id=company_id, permissions=permission_set)


def require_perms(*codes: str):
    def _dep(auth: AuthContext = Depends(get_auth)) -> AuthContext:
        if auth.role in (RoleName.SUPER_ADMIN, RoleName.OWNER):
            return auth
        for code in codes:
            if code not in auth.permissions:
                raise HTTPException(status_code=403, detail=f"Missing permission: {code}")
        return auth

    return _dep


def require_owner():
    """Price / quote approval — Owner or Super Admin only."""

    def _dep(auth: AuthContext = Depends(get_auth)) -> AuthContext:
        if auth.role in (RoleName.SUPER_ADMIN, RoleName.OWNER):
            return auth
        raise HTTPException(status_code=403, detail="Only owner can approve")

    return _dep
