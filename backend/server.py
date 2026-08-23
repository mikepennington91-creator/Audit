from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import io
import csv
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import date, datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from xml.sax.saxutils import escape
import bcrypt
import jwt
import base64
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.lib.colors import HexColor, black, white, grey
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from database import PostgresDatabase
from traceability_excel import (
    DEFAULT_CONFIG as TRACEABILITY_DEFAULT_CONFIG,
    TRACEABILITY_SCHEMAS,
    build_traceability_workbook,
    normalise_record,
    parse_traceability_workbook,
)

# UK Timezone
UK_TZ = ZoneInfo("Europe/London")

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Supabase PostgreSQL connection.  The URL should be the Supavisor transaction
# pooler string when deployed on Render.
db = PostgresDatabase(os.environ.get('DATABASE_URL', ''))

# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET_KEY') or os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET_KEY must be configured")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Create the main app
app = FastAPI(title="Infinit-Audit API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Helper function to get current UK time
def get_uk_time() -> datetime:
    return datetime.now(UK_TZ)

def get_uk_time_iso() -> str:
    return get_uk_time().isoformat()

# ==================== MODELS ====================

# Company Models
class CompanyCreate(BaseModel):
    name: str
    description: Optional[str] = None

class CompanyResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    description: Optional[str]
    created_at: str

class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

# User Models
FEATURE_KEYS = ("audits", "traceability", "documents", "actions")
DEFAULT_FEATURE_ACCESS = {
    "audits": True,
    "traceability": True,
    "documents": True,
    "actions": False,
}
ADMIN_FEATURE_ACCESS = {key: True for key in FEATURE_KEYS}

class UserRole:
    SYSTEM_ADMIN = "system_admin"  # Global admin - controls everything
    COMPANY_ADMIN = "company_admin"  # Company-specific admin
    AUDIT_CREATOR = "audit_creator"
    USER = "user"
    
    # Legacy support - map old 'admin' to new roles
    ADMIN = "admin"  # Kept for backwards compatibility, treated as company_admin

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = UserRole.USER
    company_id: Optional[str] = None
    feature_access: Dict[str, bool] = Field(default_factory=lambda: DEFAULT_FEATURE_ACCESS.copy())

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: str
    name: str
    role: str
    company_id: Optional[str] = None
    company_name: Optional[str] = None
    feature_access: Dict[str, bool] = Field(default_factory=lambda: DEFAULT_FEATURE_ACCESS.copy())
    created_at: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None
    company_id: Optional[str] = None
    feature_access: Optional[Dict[str, bool]] = None


class TraceabilityBulkExport(BaseModel):
    data_types: List[str] = Field(default_factory=lambda: ["raw", "finished", "usage"])
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class TraceabilityConfigUpdate(BaseModel):
    itemTypes: List[str] = Field(default_factory=list)
    packagingTypes: List[str] = Field(default_factory=list)

# Response Group Models
class ResponseOption(BaseModel):
    label: str
    value: str
    score: Optional[float] = None
    is_negative: bool = False  # True for Fail, No, Reject etc.

class ResponseGroupCreate(BaseModel):
    name: str
    options: List[ResponseOption]
    enable_scoring: bool = False

class ResponseGroupResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    options: List[ResponseOption]
    enable_scoring: bool
    created_by: str
    company_id: Optional[str] = None
    created_at: str

# Audit Type Models
class AuditTypeCreate(BaseModel):
    name: str
    description: Optional[str] = None

class AuditTypeResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    description: Optional[str]
    created_by: str
    company_id: Optional[str] = None
    created_at: str

# Line/Shift Models
class LineShiftCreate(BaseModel):
    title: str

class LineShiftResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    title: str
    company_id: Optional[str] = None
    created_by: str
    created_at: str

# Question Models
class QuestionType:
    RESPONSE_GROUP = "response_group"  # Use predefined or custom response options
    TEXT = "text"  # Free text input
    NUMBER = "number"  # Numeric input only
    ALPHANUMERIC = "alphanumeric"  # Letters and numbers

class QuestionCreate(BaseModel):
    text: str
    question_type: str = QuestionType.RESPONSE_GROUP  # response_group, text, number, alphanumeric
    response_group_id: Optional[str] = None
    custom_responses: Optional[List[ResponseOption]] = None
    enable_scoring: bool = False
    required: bool = True
    order: int = 0

class QuestionResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    text: str
    question_type: str = QuestionType.RESPONSE_GROUP
    response_group_id: Optional[str]
    custom_responses: Optional[List[ResponseOption]]
    enable_scoring: bool
    required: bool
    order: int

# Audit Models
class AuditCreate(BaseModel):
    name: str
    description: Optional[str] = None
    audit_type_id: Optional[str] = None
    pass_rate: Optional[float] = None
    is_private: bool = False
    questions: List[QuestionCreate] = []

class AuditResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    description: Optional[str]
    audit_type_id: Optional[str]
    audit_type_name: Optional[str]
    pass_rate: Optional[float]
    is_private: bool
    questions: List[Dict]
    created_by: str
    created_by_name: Optional[str]
    company_id: Optional[str] = None
    created_at: str
    updated_at: str

class AuditUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    audit_type_id: Optional[str] = None
    pass_rate: Optional[float] = None
    is_private: Optional[bool] = None
    questions: Optional[List[QuestionCreate]] = None

# Run Audit Models
class AnswerSubmit(BaseModel):
    question_id: str
    response_value: str
    response_label: str
    score: Optional[float] = None
    notes: Optional[str] = None
    photos: Optional[List[str]] = []
    is_negative: bool = False  # True if this is a fail/negative response
    pass_fail: Optional[str] = None  # "pass" or "fail" - manual assignment for text questions
    action_required: Optional[str] = None
    assigned_user_id: Optional[str] = None
    assigned_user_name: Optional[str] = None
    assigned_user_email: Optional[str] = None
    assigned_department: Optional[str] = None
    action_assignee_type: Optional[str] = None
    action_due_date: Optional[str] = None
    action_status: Optional[str] = None
    action_taken: Optional[str] = None
    action_completed_by: Optional[str] = None
    action_completed_at: Optional[str] = None

class RunAuditCreate(BaseModel):
    audit_id: str
    location: Optional[str] = None
    line_shift_id: Optional[str] = None  # Optional line/shift selection

class RunAuditSubmit(BaseModel):
    answers: List[AnswerSubmit]
    notes: Optional[str] = None
    completed: bool = False
    signature: Optional[str] = None  # base64 signature image
    signoff_name: Optional[str] = None
    signoff_email: Optional[str] = None

class RunAuditResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    audit_id: str
    audit_name: str
    auditor_id: str
    auditor_name: str
    location: Optional[str]
    line_shift_id: Optional[str] = None
    line_shift_title: Optional[str] = None
    answers: List[Dict]
    notes: Optional[str]
    completed: bool
    total_score: Optional[float]
    pass_status: Optional[str]
    started_at: str
    completed_at: Optional[str]
    signature: Optional[str] = None
    signoff_name: Optional[str] = None
    signoff_email: Optional[str] = None

# Corrective Action Models
class ActionAssigneeResponse(BaseModel):
    id: str
    name: str
    email: str

class CorrectiveActionUpdate(BaseModel):
    action_taken: str

class CorrectiveActionResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    company_id: Optional[str] = None
    run_id: str
    audit_id: str
    audit_name: str
    question_id: str
    question_text: str
    response_label: str
    non_conformance: str
    action_required: str
    assigned_user_id: Optional[str] = None
    assigned_user_name: Optional[str] = None
    assigned_user_email: Optional[str] = None
    assigned_department: Optional[str] = None
    due_date: str
    status: str
    action_taken: Optional[str] = None
    created_by_id: str
    created_by_name: str
    completed_by_id: Optional[str] = None
    completed_by_name: Optional[str] = None
    created_at: str
    updated_at: str
    completed_at: Optional[str] = None

# ==================== AUTH HELPERS ====================

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def normalise_feature_access(user: dict, requested: Optional[Dict[str, bool]] = None) -> Dict[str, bool]:
    """Return a complete, migration-safe feature map for a user."""
    if is_admin(user):
        return ADMIN_FEATURE_ACCESS.copy()

    access = DEFAULT_FEATURE_ACCESS.copy()
    stored = user.get("feature_access") or {}
    for key in FEATURE_KEYS:
        if key in stored:
            access[key] = bool(stored[key])
    if requested is not None:
        for key, value in requested.items():
            if key not in FEATURE_KEYS:
                raise HTTPException(status_code=400, detail=f"Unknown feature: {key}")
            access[key] = bool(value)
    return access

def has_feature(user: dict, feature: str) -> bool:
    return is_admin(user) or normalise_feature_access(user).get(feature, False)

def require_feature(feature: str):
    async def feature_checker(user: dict = Depends(get_current_user)):
        if not has_feature(user, feature):
            raise HTTPException(status_code=403, detail=f"{feature.title()} access is not enabled")
        return user
    return feature_checker

def require_role(allowed_roles: List[str], feature: Optional[str] = None):
    async def role_checker(user: dict = Depends(get_current_user)):
        if feature and not has_feature(user, feature):
            raise HTTPException(status_code=403, detail=f"{feature.title()} access is not enabled")
        user_role = user["role"]
        # System admin has access to everything
        if user_role == UserRole.SYSTEM_ADMIN:
            return user
        # Map legacy 'admin' to company_admin for permission checks
        if user_role == UserRole.ADMIN:
            user_role = UserRole.COMPANY_ADMIN
        if user_role not in allowed_roles and UserRole.SYSTEM_ADMIN not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if user_role in allowed_roles:
            return user
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return role_checker

def is_system_admin(user: dict) -> bool:
    """Check if user is a system admin"""
    return user.get("role") == UserRole.SYSTEM_ADMIN

def is_admin(user: dict) -> bool:
    """Check if user is any type of admin"""
    return user.get("role") in [UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN]

def can_access_company_record(user: dict, record: dict) -> bool:
    if is_system_admin(user):
        return True
    return record.get("company_id") == user.get("company_id")

def corrective_action_status(action: dict) -> str:
    if action.get("status") == "completed":
        return "completed"
    try:
        if date.fromisoformat(action.get("due_date", "")) < get_uk_time().date():
            return "overdue"
    except (TypeError, ValueError):
        pass
    return "open"

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register", response_model=dict)
async def register(user_data: UserCreate):
    existing = await db.users.find_one({"email": user_data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_id = str(uuid.uuid4())
    requested_user = {"role": user_data.role, "feature_access": user_data.feature_access}
    user_doc = {
        "id": user_id,
        "email": user_data.email,
        "password": hash_password(user_data.password),
        "name": user_data.name,
        "role": user_data.role,
        "company_id": user_data.company_id,
        "feature_access": normalise_feature_access(requested_user, user_data.feature_access),
        "created_at": get_uk_time_iso()
    }
    await db.users.insert_one(user_doc)
    
    token = create_token(user_id, user_data.email, user_data.role)
    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": user_data.email,
            "name": user_data.name,
            "role": user_data.role,
            "company_id": user_data.company_id,
            "feature_access": user_doc["feature_access"]
        }
    }

@api_router.post("/auth/login", response_model=dict)
async def login(credentials: UserLogin):
    user = await db.users.find_one({"email": credentials.email})
    if not user or not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(user["id"], user["email"], user["role"])
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "company_id": user.get("company_id"),
            "feature_access": normalise_feature_access(user)
        }
    }

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(user: dict = Depends(get_current_user)):
    # Get company name if assigned
    if user.get("company_id"):
        company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
        if company:
            user["company_name"] = company["name"]
    user["feature_access"] = normalise_feature_access(user)
    return UserResponse(**user)

# ==================== COMPANY MANAGEMENT (SYSTEM ADMIN ONLY) ====================

@api_router.post("/companies", response_model=CompanyResponse)
async def create_company(company_data: CompanyCreate, user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN]))):
    company_id = str(uuid.uuid4())
    company_doc = {
        "id": company_id,
        "name": company_data.name,
        "description": company_data.description,
        "created_at": get_uk_time_iso()
    }
    await db.companies.insert_one(company_doc)
    return CompanyResponse(**company_doc)

@api_router.get("/companies", response_model=List[CompanyResponse])
async def get_companies(user: dict = Depends(get_current_user)):
    # System admin sees all companies
    # Company admin/users only see their own company
    if is_system_admin(user):
        companies = await db.companies.find({}, {"_id": 0}).to_list(1000)
    elif user.get("company_id"):
        companies = await db.companies.find({"id": user["company_id"]}, {"_id": 0}).to_list(1)
    else:
        companies = []
    return [CompanyResponse(**c) for c in companies]

@api_router.get("/companies/{company_id}", response_model=CompanyResponse)
async def get_company(company_id: str, user: dict = Depends(get_current_user)):
    # Check access
    if not is_system_admin(user) and user.get("company_id") != company_id:
        raise HTTPException(status_code=403, detail="Access denied")
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return CompanyResponse(**company)

@api_router.put("/companies/{company_id}", response_model=CompanyResponse)
async def update_company(company_id: str, update_data: CompanyUpdate, user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN]))):
    update_dict = {k: v for k, v in update_data.model_dump().items() if v is not None}
    if not update_dict:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await db.companies.update_one({"id": company_id}, {"$set": update_dict})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Company not found")
    
    updated = await db.companies.find_one({"id": company_id}, {"_id": 0})
    return CompanyResponse(**updated)

@api_router.delete("/companies/{company_id}")
async def delete_company(company_id: str, user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN]))):
    # Check if any users are assigned to this company
    user_count = await db.users.count_documents({"company_id": company_id})
    if user_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete company with {user_count} assigned users")
    
    result = await db.companies.delete_one({"id": company_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Company not found")
    return {"message": "Company deleted successfully"}

# ==================== USER MANAGEMENT ====================

@api_router.get("/users", response_model=List[UserResponse])
async def get_users(user: dict = Depends(get_current_user)):
    # System admin sees all users
    # Company admin sees only users in their company
    if is_system_admin(user):
        query = {}
    elif is_admin(user) and user.get("company_id"):
        query = {"company_id": user["company_id"]}
    else:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    users = await db.users.find(query, {"_id": 0, "password": 0}).to_list(1000)
    # Add company names
    for u in users:
        u["feature_access"] = normalise_feature_access(u)
        if u.get("company_id"):
            company = await db.companies.find_one({"id": u["company_id"]}, {"_id": 0})
            if company:
                u["company_name"] = company["name"]
    return [UserResponse(**u) for u in users]

@api_router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: str, update_data: UserUpdate, user: dict = Depends(get_current_user)):
    # Check permissions
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    # Get target user
    target_user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Company admin can only update users in their company
    if not is_system_admin(user):
        if target_user.get("company_id") != user.get("company_id"):
            raise HTTPException(status_code=403, detail="Cannot modify users from other companies")
        # Company admin cannot change company_id or create system admins
        if update_data.company_id and update_data.company_id != user.get("company_id"):
            raise HTTPException(status_code=403, detail="Cannot assign users to other companies")
        if update_data.role == UserRole.SYSTEM_ADMIN:
            raise HTTPException(status_code=403, detail="Cannot create system administrators")
    
    update_dict = {k: v for k, v in update_data.model_dump().items() if v is not None}
    if update_data.feature_access is not None:
        proposed_user = {**target_user, "role": update_data.role or target_user.get("role")}
        update_dict["feature_access"] = normalise_feature_access(proposed_user, update_data.feature_access)
    if "password" in update_dict:
        update_dict["password"] = hash_password(update_dict["password"])
    
    # Handle company_id being set to empty string (unassign)
    if update_data.company_id == "":
        update_dict["company_id"] = None
    
    if not update_dict:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await db.users.update_one({"id": user_id}, {"$set": update_dict})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    updated_user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    updated_user["feature_access"] = normalise_feature_access(updated_user)
    if updated_user.get("company_id"):
        company = await db.companies.find_one({"id": updated_user["company_id"]}, {"_id": 0})
        if company:
            updated_user["company_name"] = company["name"]
    return UserResponse(**updated_user)

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    # Get target user
    target_user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Company admin can only delete users in their company
    if not is_system_admin(user):
        if target_user.get("company_id") != user.get("company_id"):
            raise HTTPException(status_code=403, detail="Cannot delete users from other companies")
        # Cannot delete system admins
        if target_user.get("role") == UserRole.SYSTEM_ADMIN:
            raise HTTPException(status_code=403, detail="Cannot delete system administrators")
    
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted successfully"}

# ==================== RESPONSE GROUPS ====================

@api_router.post("/response-groups", response_model=ResponseGroupResponse)
async def create_response_group(
    group_data: ResponseGroupCreate,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "audits"))
):
    group_id = str(uuid.uuid4())
    group_doc = {
        "id": group_id,
        "name": group_data.name,
        "options": [opt.model_dump() for opt in group_data.options],
        "enable_scoring": group_data.enable_scoring,
        "created_by": user["id"],
        "company_id": user.get("company_id"),  # Associate with user's company
        "created_at": get_uk_time_iso()
    }
    await db.response_groups.insert_one(group_doc)
    return ResponseGroupResponse(**group_doc)

@api_router.get("/response-groups", response_model=List[ResponseGroupResponse])
async def get_response_groups(user: dict = Depends(require_feature("audits"))):
    # System admin sees all, others see only their company's groups
    if is_system_admin(user):
        groups = await db.response_groups.find({}, {"_id": 0}).to_list(1000)
    else:
        # Show groups from same company or groups with no company (system defaults)
        query = {"$or": [
            {"company_id": user.get("company_id")},
            {"company_id": None}
        ]}
        if user.get("company_id"):
            query = {"$or": [
                {"company_id": user.get("company_id")},
                {"company_id": None}
            ]}
        else:
            query = {"company_id": None}
        groups = await db.response_groups.find(query, {"_id": 0}).to_list(1000)
    return [ResponseGroupResponse(**g) for g in groups]

@api_router.get("/response-groups/{group_id}", response_model=ResponseGroupResponse)
async def get_response_group(group_id: str, user: dict = Depends(require_feature("audits"))):
    group = await db.response_groups.find_one({"id": group_id}, {"_id": 0})
    if not group:
        raise HTTPException(status_code=404, detail="Response group not found")
    return ResponseGroupResponse(**group)

@api_router.delete("/response-groups/{group_id}")
async def delete_response_group(
    group_id: str,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "audits"))
):
    result = await db.response_groups.delete_one({"id": group_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Response group not found")
    return {"message": "Response group deleted successfully"}

# ==================== AUDIT TYPES ====================

@api_router.post("/audit-types", response_model=AuditTypeResponse)
async def create_audit_type(
    type_data: AuditTypeCreate,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "audits"))
):
    type_id = str(uuid.uuid4())
    type_doc = {
        "id": type_id,
        "name": type_data.name,
        "description": type_data.description,
        "created_by": user["id"],
        "company_id": user.get("company_id"),  # Associate with user's company
        "created_at": get_uk_time_iso()
    }
    await db.audit_types.insert_one(type_doc)
    return AuditTypeResponse(**type_doc)

@api_router.get("/audit-types", response_model=List[AuditTypeResponse])
async def get_audit_types(user: dict = Depends(require_feature("audits"))):
    # System admin sees all, others see only their company's types
    if is_system_admin(user):
        types = await db.audit_types.find({}, {"_id": 0}).to_list(1000)
    else:
        query = {"$or": [
            {"company_id": user.get("company_id")},
            {"company_id": None}
        ]}
        if user.get("company_id"):
            query = {"$or": [
                {"company_id": user.get("company_id")},
                {"company_id": None}
            ]}
        else:
            query = {"company_id": None}
        types = await db.audit_types.find(query, {"_id": 0}).to_list(1000)
    return [AuditTypeResponse(**t) for t in types]

@api_router.delete("/audit-types/{type_id}")
async def delete_audit_type(
    type_id: str,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "audits"))
):
    result = await db.audit_types.delete_one({"id": type_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Audit type not found")
    return {"message": "Audit type deleted successfully"}

# ==================== LINES/SHIFTS ====================

@api_router.post("/lines-shifts", response_model=LineShiftResponse)
async def create_line_shift(
    data: LineShiftCreate,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN], "audits"))
):
    """Create a new line/shift (Admin only)"""
    line_id = str(uuid.uuid4())
    line_doc = {
        "id": line_id,
        "title": data.title,
        "company_id": user.get("company_id"),
        "created_by": user["id"],
        "created_at": get_uk_time_iso()
    }
    await db.lines_shifts.insert_one(line_doc)
    return LineShiftResponse(**line_doc)

@api_router.get("/lines-shifts", response_model=List[LineShiftResponse])
async def get_lines_shifts(user: dict = Depends(require_feature("audits"))):
    """Get all lines/shifts for user's company"""
    if is_system_admin(user):
        lines = await db.lines_shifts.find({}, {"_id": 0}).to_list(1000)
    else:
        # Show lines from same company
        query = {"company_id": user.get("company_id")} if user.get("company_id") else {"company_id": None}
        lines = await db.lines_shifts.find(query, {"_id": 0}).to_list(1000)
    return [LineShiftResponse(**l) for l in lines]

@api_router.get("/lines-shifts/{line_id}", response_model=LineShiftResponse)
async def get_line_shift(line_id: str, user: dict = Depends(require_feature("audits"))):
    line = await db.lines_shifts.find_one({"id": line_id}, {"_id": 0})
    if not line:
        raise HTTPException(status_code=404, detail="Line/Shift not found")
    # Check access
    if not is_system_admin(user) and line.get("company_id") != user.get("company_id"):
        raise HTTPException(status_code=403, detail="Access denied")
    return LineShiftResponse(**line)

@api_router.put("/lines-shifts/{line_id}", response_model=LineShiftResponse)
async def update_line_shift(
    line_id: str,
    data: LineShiftCreate,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN], "audits"))
):
    """Update a line/shift (Admin only)"""
    line = await db.lines_shifts.find_one({"id": line_id}, {"_id": 0})
    if not line:
        raise HTTPException(status_code=404, detail="Line/Shift not found")
    
    # Company admin can only update their company's lines
    if not is_system_admin(user) and line.get("company_id") != user.get("company_id"):
        raise HTTPException(status_code=403, detail="Access denied")
    
    await db.lines_shifts.update_one({"id": line_id}, {"$set": {"title": data.title}})
    updated = await db.lines_shifts.find_one({"id": line_id}, {"_id": 0})
    return LineShiftResponse(**updated)

@api_router.delete("/lines-shifts/{line_id}")
async def delete_line_shift(
    line_id: str,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN], "audits"))
):
    """Delete a line/shift (Admin only)"""
    line = await db.lines_shifts.find_one({"id": line_id}, {"_id": 0})
    if not line:
        raise HTTPException(status_code=404, detail="Line/Shift not found")
    
    # Company admin can only delete their company's lines
    if not is_system_admin(user) and line.get("company_id") != user.get("company_id"):
        raise HTTPException(status_code=403, detail="Access denied")
    
    result = await db.lines_shifts.delete_one({"id": line_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Line/Shift not found")
    return {"message": "Line/Shift deleted successfully"}

# ==================== AUDITS ====================

@api_router.post("/audits", response_model=AuditResponse)
async def create_audit(
    audit_data: AuditCreate,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "audits"))
):
    audit_id = str(uuid.uuid4())
    now = get_uk_time_iso()
    
    # Process questions
    questions = []
    for i, q in enumerate(audit_data.questions):
        question_doc = {
            "id": str(uuid.uuid4()),
            "text": q.text,
            "question_type": q.question_type,  # New field
            "response_group_id": q.response_group_id,
            "custom_responses": [r.model_dump() for r in q.custom_responses] if q.custom_responses else None,
            "enable_scoring": q.enable_scoring,
            "required": q.required,
            "order": i
        }
        questions.append(question_doc)
    
    # Get audit type name if provided
    audit_type_name = None
    if audit_data.audit_type_id:
        audit_type = await db.audit_types.find_one({"id": audit_data.audit_type_id}, {"_id": 0})
        if audit_type:
            audit_type_name = audit_type["name"]
    
    audit_doc = {
        "id": audit_id,
        "name": audit_data.name,
        "description": audit_data.description,
        "audit_type_id": audit_data.audit_type_id,
        "audit_type_name": audit_type_name,
        "pass_rate": audit_data.pass_rate,
        "is_private": audit_data.is_private,
        "questions": questions,
        "created_by": user["id"],
        "created_by_name": user["name"],
        "company_id": user.get("company_id"),  # Associate with user's company
        "created_at": now,
        "updated_at": now
    }
    await db.audits.insert_one(audit_doc)
    return AuditResponse(**audit_doc)

@api_router.get("/audits", response_model=List[AuditResponse])
async def get_audits(user: dict = Depends(require_feature("audits"))):
    # System admin sees all audits
    if is_system_admin(user):
        query = {}
    else:
        # Users see audits from their company (public ones) or their own private ones
        company_id = user.get("company_id")
        if company_id:
            query = {"$or": [
                {"company_id": company_id, "is_private": False},
                {"created_by": user["id"]},
                {"company_id": None, "is_private": False}
            ]}
        else:
            query = {"$or": [
                {"is_private": False, "company_id": None},
                {"created_by": user["id"]}
            ]}
    
    audits = await db.audits.find(query, {"_id": 0}).to_list(1000)
    return [AuditResponse(**a) for a in audits]

@api_router.get("/audits/{audit_id}", response_model=AuditResponse)
async def get_audit(audit_id: str, user: dict = Depends(require_feature("audits"))):
    audit = await db.audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
    if audit["is_private"] and audit["created_by"] != user["id"] and user["role"] == UserRole.USER:
        raise HTTPException(status_code=403, detail="Access denied")
    return AuditResponse(**audit)

@api_router.put("/audits/{audit_id}", response_model=AuditResponse)
async def update_audit(
    audit_id: str,
    update_data: AuditUpdate,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "audits"))
):
    update_dict = {}
    if update_data.name is not None:
        update_dict["name"] = update_data.name
    if update_data.description is not None:
        update_dict["description"] = update_data.description
    if update_data.audit_type_id is not None:
        update_dict["audit_type_id"] = update_data.audit_type_id
        audit_type = await db.audit_types.find_one({"id": update_data.audit_type_id}, {"_id": 0})
        update_dict["audit_type_name"] = audit_type["name"] if audit_type else None
    if update_data.pass_rate is not None:
        update_dict["pass_rate"] = update_data.pass_rate
    if update_data.is_private is not None:
        update_dict["is_private"] = update_data.is_private
    if update_data.questions is not None:
        questions = []
        for i, q in enumerate(update_data.questions):
            question_doc = {
                "id": str(uuid.uuid4()),
                "text": q.text,
                "question_type": q.question_type,  # New field
                "response_group_id": q.response_group_id,
                "custom_responses": [r.model_dump() for r in q.custom_responses] if q.custom_responses else None,
                "enable_scoring": q.enable_scoring,
                "required": q.required,
                "order": i
            }
            questions.append(question_doc)
        update_dict["questions"] = questions
    
    update_dict["updated_at"] = get_uk_time_iso()
    
    result = await db.audits.update_one({"id": audit_id}, {"$set": update_dict})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Audit not found")
    
    updated = await db.audits.find_one({"id": audit_id}, {"_id": 0})
    return AuditResponse(**updated)

@api_router.delete("/audits/{audit_id}")
async def delete_audit(
    audit_id: str,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "audits"))
):
    result = await db.audits.delete_one({"id": audit_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Audit not found")
    return {"message": "Audit deleted successfully"}

# ==================== AUDIT RUNS OVERVIEW ====================

@api_router.get("/audits/{audit_id}/runs")
async def get_audit_runs(
    audit_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    pass_status: Optional[str] = None,
    user: dict = Depends(require_feature("audits"))
):
    """Get all completed runs for a specific audit with stats and filtering"""
    audit = await db.audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
    
    # Build query for filtered runs
    query = {"audit_id": audit_id, "completed": True}
    
    if date_from:
        query.setdefault("completed_at", {})
        query["completed_at"]["$gte"] = date_from
    if date_to:
        query.setdefault("completed_at", {})
        query["completed_at"]["$lte"] = date_to
    if pass_status and pass_status != "all":
        query["pass_status"] = pass_status
    
    runs = await db.run_audits.find(query, {"_id": 0, "signature": 0}).sort("completed_at", -1).to_list(1000)
    
    # Calculate overall stats (unfiltered)
    all_completed = await db.run_audits.count_documents({"audit_id": audit_id, "completed": True})
    passed = await db.run_audits.count_documents({"audit_id": audit_id, "completed": True, "pass_status": "pass"})
    failed = await db.run_audits.count_documents({"audit_id": audit_id, "completed": True, "pass_status": "fail"})
    pass_percentage = (passed / all_completed * 100) if all_completed > 0 else 0
    
    return {
        "audit": {k: v for k, v in audit.items() if k != "_id"},
        "stats": {
            "total_completed": all_completed,
            "passed": passed,
            "failed": failed,
            "pass_percentage": round(pass_percentage, 1)
        },
        "runs": runs
    }

# ==================== RUN AUDITS ====================

@api_router.post("/run-audits", response_model=RunAuditResponse)
async def start_run_audit(run_data: RunAuditCreate, user: dict = Depends(require_feature("audits"))):
    audit = await db.audits.find_one({"id": run_data.audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
    
    # Get line/shift info if provided
    line_shift_title = None
    if run_data.line_shift_id:
        line_shift = await db.lines_shifts.find_one({"id": run_data.line_shift_id}, {"_id": 0})
        if line_shift:
            line_shift_title = line_shift["title"]
    
    run_id = str(uuid.uuid4())
    run_doc = {
        "id": run_id,
        "audit_id": run_data.audit_id,
        "audit_name": audit["name"],
        "auditor_id": user["id"],
        "auditor_name": user["name"],
        "company_id": user.get("company_id"),
        "location": run_data.location,
        "line_shift_id": run_data.line_shift_id,
        "line_shift_title": line_shift_title,
        "answers": [],
        "notes": None,
        "completed": False,
        "total_score": None,
        "pass_status": None,
        "started_at": get_uk_time_iso(),
        "completed_at": None,
        "signature": None,
        "signoff_name": None,
        "signoff_email": None
    }
    await db.run_audits.insert_one(run_doc)
    return RunAuditResponse(**run_doc)

async def prepare_corrective_actions(run_audit: dict, audit: dict, answers: List[dict], user: dict) -> None:
    """Validate failed answers, enrich their assignee details and create action records."""
    question_map = {question["id"]: question for question in audit.get("questions", [])}

    for answer in answers:
        if not answer.get("is_negative"):
            continue

        required_action = (answer.get("action_required") or "").strip()
        assigned_user_id = (answer.get("assigned_user_id") or "").strip()
        assigned_department = (answer.get("assigned_department") or "").strip()
        due_date = (answer.get("action_due_date") or "").strip()

        if not required_action:
            raise HTTPException(status_code=400, detail="Action required must be completed for every non-conformance")
        if bool(assigned_user_id) == bool(assigned_department):
            raise HTTPException(status_code=400, detail="Assign every non-conformance to either a user or a department")
        try:
            parsed_due_date = date.fromisoformat(due_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="A valid due date is required for every non-conformance")
        if parsed_due_date < get_uk_time().date():
            raise HTTPException(status_code=400, detail="Corrective action due dates cannot be in the past")

        assigned_user = None
        if assigned_user_id:
            assigned_user = await db.users.find_one({"id": assigned_user_id}, {"_id": 0, "password": 0})
            if not assigned_user:
                raise HTTPException(status_code=400, detail="The selected action owner no longer exists")
            if not is_system_admin(user) and assigned_user.get("company_id") != user.get("company_id"):
                raise HTTPException(status_code=403, detail="Actions can only be assigned within your company")
            answer["assigned_user_name"] = assigned_user["name"]
            answer["assigned_user_email"] = assigned_user["email"]
            answer["assigned_department"] = None
        else:
            answer["assigned_user_id"] = None
            answer["assigned_user_name"] = None
            answer["assigned_user_email"] = None
            answer["assigned_department"] = assigned_department

        answer["action_required"] = required_action
        answer["action_due_date"] = due_date
        answer["action_status"] = "open"
        action_company_id = run_audit.get("company_id") or (assigned_user or {}).get("company_id")
        action_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"infinit-audit:{run_audit['id']}:{answer['question_id']}"))
        now = get_uk_time_iso()
        base_action = {
            "run_id": run_audit["id"],
            "audit_id": run_audit["audit_id"],
            "audit_name": run_audit["audit_name"],
            "company_id": action_company_id,
            "question_id": answer["question_id"],
            "question_text": question_map.get(answer["question_id"], {}).get("text", "Question not found"),
            "response_label": answer.get("response_label") or "N/A",
            "non_conformance": (answer.get("notes") or "").strip(),
            "action_required": required_action,
            "assigned_user_id": answer.get("assigned_user_id"),
            "assigned_user_name": answer.get("assigned_user_name"),
            "assigned_user_email": answer.get("assigned_user_email"),
            "assigned_department": answer.get("assigned_department"),
            "due_date": due_date,
            "updated_at": now,
        }
        existing = await db.corrective_actions.find_one({"id": action_id}, {"_id": 0})
        if existing:
            if existing.get("status") == "completed":
                answer["action_status"] = "completed"
                answer["action_taken"] = existing.get("action_taken")
                answer["action_completed_by"] = existing.get("completed_by_name")
                answer["action_completed_at"] = existing.get("completed_at")
            await db.corrective_actions.update_one({"id": action_id}, {"$set": base_action})
        else:
            await db.corrective_actions.insert_one({
                "id": action_id,
                **base_action,
                "status": "open",
                "action_taken": None,
                "created_by_id": user["id"],
                "created_by_name": user["name"],
                "completed_by_id": None,
                "completed_by_name": None,
                "created_at": now,
                "completed_at": None,
            })

@api_router.put("/run-audits/{run_id}", response_model=RunAuditResponse)
async def update_run_audit(run_id: str, submit_data: RunAuditSubmit, user: dict = Depends(require_feature("audits"))):
    run_audit = await db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run_audit:
        raise HTTPException(status_code=404, detail="Run audit not found")
    if run_audit["auditor_id"] != user["id"] and user["role"] not in [UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Validate that negative responses have comments
    answers = [a.model_dump() for a in submit_data.answers]
    for answer in answers:
        if answer.get("is_negative") and not answer.get("notes"):
            raise HTTPException(
                status_code=400, 
                detail=f"Comment required for negative/fail response on question"
            )
    
    audit = None
    if submit_data.completed:
        audit = await db.audits.find_one({"id": run_audit["audit_id"]}, {"_id": 0})
        if not audit:
            raise HTTPException(status_code=404, detail="Audit template not found")
        await prepare_corrective_actions(run_audit, audit, answers, user)

    # Calculate score based on pass/fail per question
    total_score = None
    pass_status = None
    
    if submit_data.completed:
        total_questions = len(answers)
        if total_questions > 0:
            pass_count = 0
            for answer in answers:
                pf = answer.get("pass_fail")
                if pf == "pass":
                    pass_count += 1
                elif pf == "fail":
                    pass  # counted as fail
                elif not answer.get("is_negative"):
                    pass_count += 1  # backward compat: non-negative = pass
            
            total_score = (pass_count / total_questions) * 100
            if audit and audit.get("pass_rate"):
                pass_status = "pass" if total_score >= audit["pass_rate"] else "fail"
    
    update_dict = {
        "answers": answers,
        "notes": submit_data.notes,
        "completed": submit_data.completed,
        "total_score": total_score,
        "pass_status": pass_status,
        "signature": submit_data.signature,
        "signoff_name": submit_data.signoff_name,
        "signoff_email": submit_data.signoff_email
    }
    if submit_data.completed:
        update_dict["completed_at"] = get_uk_time_iso()
    
    await db.run_audits.update_one({"id": run_id}, {"$set": update_dict})
    updated = await db.run_audits.find_one({"id": run_id}, {"_id": 0})
    return RunAuditResponse(**updated)

@api_router.get("/run-audits", response_model=List[RunAuditResponse])
async def get_run_audits(
    completed: Optional[bool] = None,
    user: dict = Depends(require_feature("audits"))
):
    query = {}
    if user["role"] == UserRole.USER:
        query["auditor_id"] = user["id"]
    if completed is not None:
        query["completed"] = completed
    
    runs = await db.run_audits.find(query, {"_id": 0}).sort("started_at", -1).to_list(1000)
    return [RunAuditResponse(**r) for r in runs]

@api_router.get("/run-audits/{run_id}", response_model=RunAuditResponse)
async def get_run_audit(run_id: str, user: dict = Depends(require_feature("audits"))):
    run_audit = await db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run_audit:
        raise HTTPException(status_code=404, detail="Run audit not found")
    if run_audit["auditor_id"] != user["id"] and user["role"] not in [UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR]:
        raise HTTPException(status_code=403, detail="Access denied")
    return RunAuditResponse(**run_audit)

@api_router.get("/run-audits/{run_id}/details")
async def get_run_audit_details(run_id: str, user: dict = Depends(require_feature("audits"))):
    """Get detailed run audit with full question text and answers"""
    run_audit = await db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run_audit:
        raise HTTPException(status_code=404, detail="Run audit not found")
    if run_audit["auditor_id"] != user["id"] and user["role"] not in [UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Get the audit template to get question texts
    audit = await db.audits.find_one({"id": run_audit["audit_id"]}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Audit template not found")
    
    # Create a map of question id to question details
    question_map = {q["id"]: q for q in audit.get("questions", [])}
    
    # Enrich answers with question text
    enriched_answers = []
    for answer in run_audit.get("answers", []):
        question = question_map.get(answer.get("question_id"), {})
        enriched_answer = {
            **answer,
            "question_text": question.get("text", "Question not found"),
            "question_required": question.get("required", True)
        }
        enriched_answers.append(enriched_answer)
    
    return {
        **run_audit,
        "audit_description": audit.get("description"),
        "audit_pass_rate": audit.get("pass_rate"),
        "questions": audit.get("questions", []),
        "enriched_answers": enriched_answers
    }

# ==================== CORRECTIVE ACTIONS ====================

@api_router.get("/action-assignees", response_model=List[ActionAssigneeResponse])
async def get_action_assignees(user: dict = Depends(require_feature("audits"))):
    """Return a minimal, company-scoped list for assigning audit actions."""
    query = {} if is_system_admin(user) else {"company_id": user.get("company_id")}
    users = await db.users.find(query, {"_id": 0, "password": 0}).sort("name", 1).to_list(1000)
    return [ActionAssigneeResponse(id=item["id"], name=item["name"], email=item["email"]) for item in users]

@api_router.get("/actions", response_model=List[CorrectiveActionResponse])
async def get_corrective_actions(
    status: Optional[str] = None,
    assigned_to_me: bool = False,
    user: dict = Depends(require_feature("actions")),
):
    if status and status not in {"open", "overdue", "completed"}:
        raise HTTPException(status_code=400, detail="Unknown action status")

    query = {} if is_system_admin(user) else {"company_id": user.get("company_id")}
    if assigned_to_me:
        query["assigned_user_id"] = user["id"]
    actions = await db.corrective_actions.find(query, {"_id": 0}).sort("due_date", 1).to_list(5000)
    results = []
    for action in actions:
        action = {**action, "status": corrective_action_status(action)}
        if not status or action["status"] == status:
            results.append(CorrectiveActionResponse(**action))
    return results

async def get_accessible_corrective_action(action_id: str, user: dict) -> dict:
    action = await db.corrective_actions.find_one({"id": action_id}, {"_id": 0})
    if not action:
        raise HTTPException(status_code=404, detail="Corrective action not found")
    if not can_access_company_record(user, action):
        raise HTTPException(status_code=403, detail="Access denied")
    return action

@api_router.put("/actions/{action_id}", response_model=CorrectiveActionResponse)
async def complete_corrective_action(
    action_id: str,
    update: CorrectiveActionUpdate,
    user: dict = Depends(require_feature("actions")),
):
    action = await get_accessible_corrective_action(action_id, user)
    action_taken = update.action_taken.strip()
    if not action_taken:
        raise HTTPException(status_code=400, detail="Action taken is required before completion")

    now = get_uk_time_iso()
    await db.corrective_actions.update_one({"id": action_id}, {"$set": {
        "action_taken": action_taken,
        "status": "completed",
        "completed_by_id": user["id"],
        "completed_by_name": user["name"],
        "completed_at": now,
        "updated_at": now,
    }})
    run_audit = await db.run_audits.find_one({"id": action["run_id"]}, {"_id": 0})
    if run_audit:
        updated_answers = []
        for answer in run_audit.get("answers", []):
            if answer.get("question_id") == action["question_id"]:
                answer = {
                    **answer,
                    "action_status": "completed",
                    "action_taken": action_taken,
                    "action_completed_by": user["name"],
                    "action_completed_at": now,
                }
            updated_answers.append(answer)
        await db.run_audits.update_one({"id": action["run_id"]}, {"$set": {"answers": updated_answers}})
    updated = await db.corrective_actions.find_one({"id": action_id}, {"_id": 0})
    return CorrectiveActionResponse(**updated)

@api_router.get("/actions/{action_id}/pdf")
async def export_corrective_action_pdf(action_id: str, user: dict = Depends(require_feature("actions"))):
    action = await get_accessible_corrective_action(action_id, user)
    display_status = corrective_action_status(action)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=1.5*cm, leftMargin=1.5*cm, topMargin=1.5*cm, bottomMargin=1.5*cm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('ActionTitle', parent=styles['Heading1'], fontSize=20, textColor=HexColor('#1a7a6e'), spaceAfter=18)
    section_style = ParagraphStyle('ActionSection', parent=styles['Heading2'], fontSize=13, textColor=HexColor('#1a7a6e'), spaceBefore=14, spaceAfter=8)
    normal_style = styles['Normal']
    assigned_to = action.get("assigned_user_name") or action.get("assigned_department") or "Unassigned"

    story = [
        Paragraph("INFINIT-AUDIT", title_style),
        Paragraph("<b>Corrective Action Report</b>", styles['Heading2']),
        Spacer(1, 0.25*inch),
    ]
    meta_data = [
        ["Audit:", action.get("audit_name", "N/A")],
        ["Status:", display_status.title()],
        ["Assigned to:", assigned_to],
        ["Due date:", action.get("due_date", "N/A")],
        ["Raised by:", action.get("created_by_name", "N/A")],
        ["Raised:", format_uk_datetime(action.get("created_at"))],
    ]
    meta_table = Table(meta_data, colWidths=[1.6*inch, 4.4*inch])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), HexColor('#f0f9f8')),
        ('TEXTCOLOR', (0, 0), (0, -1), HexColor('#1a7a6e')),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e0e0e0')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('PADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(meta_table)
    sections = [
        ("Audit Question", action.get("question_text")),
        ("Non-Conformance", action.get("non_conformance")),
        ("Action Required", action.get("action_required")),
        ("Action Taken", action.get("action_taken") or "Not yet completed"),
    ]
    for heading, value in sections:
        story.append(Paragraph(heading, section_style))
        story.append(Paragraph(escape(str(value or "N/A")), normal_style))

    if action.get("completed_at"):
        story.append(Paragraph("Completion", section_style))
        story.append(Paragraph(
            f"Completed by {escape(action.get('completed_by_name') or 'N/A')} on {escape(format_uk_datetime(action.get('completed_at')))}",
            normal_style,
        ))
    story.append(Spacer(1, 0.5*inch))
    footer_style = ParagraphStyle('ActionFooter', parent=styles['Normal'], fontSize=8, textColor=grey, alignment=TA_CENTER)
    story.append(Paragraph(f"Generated by Infinit-Audit on {format_uk_datetime(get_uk_time_iso())}", footer_style))
    doc.build(story)
    buffer.seek(0)

    filename = f"action_report_{action_id[:8]}_{datetime.now().strftime('%Y%m%d')}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})

# ==================== PHOTO UPLOAD ====================

@api_router.post("/upload-photo")
async def upload_photo(file: UploadFile = File(...), user: dict = Depends(require_feature("audits"))):
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:  # 5MB limit
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")
    
    # Store as base64 in database (for simplicity)
    photo_id = str(uuid.uuid4())
    base64_content = base64.b64encode(content).decode('utf-8')
    content_type = file.content_type or "image/jpeg"
    
    photo_doc = {
        "id": photo_id,
        "filename": file.filename,
        "content_type": content_type,
        "data": f"data:{content_type};base64,{base64_content}",
        "uploaded_by": user["id"],
        "uploaded_at": get_uk_time_iso()
    }
    await db.photos.insert_one(photo_doc)
    
    return {"id": photo_id, "url": f"data:{content_type};base64,{base64_content}"}

# ==================== DASHBOARD STATS ====================

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(user: dict = Depends(require_feature("audits"))):
    if user["role"] == UserRole.USER:
        total_runs = await db.run_audits.count_documents({"auditor_id": user["id"]})
        completed_runs = await db.run_audits.count_documents({"auditor_id": user["id"], "completed": True})
        passed_runs = await db.run_audits.count_documents({"auditor_id": user["id"], "pass_status": "pass"})
    else:
        total_runs = await db.run_audits.count_documents({})
        completed_runs = await db.run_audits.count_documents({"completed": True})
        passed_runs = await db.run_audits.count_documents({"pass_status": "pass"})
    
    total_audits = await db.audits.count_documents({})
    total_users = await db.users.count_documents({})
    
    pass_rate = (passed_runs / completed_runs * 100) if completed_runs > 0 else 0
    
    return {
        "total_audits": total_audits,
        "total_runs": total_runs,
        "completed_runs": completed_runs,
        "passed_runs": passed_runs,
        "pass_rate": round(pass_rate, 1),
        "total_users": total_users
    }

# ==================== HEALTH CHECK ====================

# ==================== PDF EXPORT ====================

def format_uk_datetime(iso_string: str) -> str:
    """Format ISO datetime to UK readable format"""
    if not iso_string:
        return "N/A"
    try:
        dt = datetime.fromisoformat(iso_string.replace('Z', '+00:00'))
        return dt.strftime("%d/%m/%Y %H:%M")
    except:
        return iso_string

@api_router.get("/run-audits/{run_id}/pdf")
async def export_audit_pdf(run_id: str, user: dict = Depends(require_feature("audits"))):
    """Generate PDF report for a completed audit"""
    run_audit = await db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run_audit:
        raise HTTPException(status_code=404, detail="Run audit not found")
    if run_audit["auditor_id"] != user["id"] and user["role"] not in [UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Get audit template
    audit = await db.audits.find_one({"id": run_audit["audit_id"]}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Audit template not found")
    
    # Create question map
    question_map = {q["id"]: q for q in audit.get("questions", [])}
    
    # Create PDF
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=1.5*cm, leftMargin=1.5*cm, topMargin=1.5*cm, bottomMargin=1.5*cm)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=20, textColor=HexColor('#1a7a6e'), spaceAfter=20)
    heading_style = ParagraphStyle('Heading', parent=styles['Heading2'], fontSize=14, textColor=HexColor('#1a7a6e'), spaceBefore=15, spaceAfter=10)
    normal_style = styles['Normal']
    
    story = []
    
    # Header
    story.append(Paragraph("INFINIT-AUDIT", title_style))
    story.append(Paragraph(f"<b>Audit Report: {run_audit['audit_name']}</b>", styles['Heading2']))
    story.append(Spacer(1, 0.3*inch))
    
    # Meta information table
    meta_data = [
        ["Auditor:", run_audit.get("auditor_name", "N/A")],
        ["Location:", run_audit.get("location", "N/A")],
        ["Started:", format_uk_datetime(run_audit.get("started_at"))],
        ["Completed:", format_uk_datetime(run_audit.get("completed_at"))],
        ["Status:", run_audit.get("pass_status", "Completed").upper() if run_audit.get("pass_status") else "Completed"],
        ["Score:", f"{round(run_audit.get('total_score', 0))}%" if run_audit.get('total_score') is not None else "N/A"],
    ]
    
    meta_table = Table(meta_data, colWidths=[2*inch, 4*inch])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), HexColor('#f0f9f8')),
        ('TEXTCOLOR', (0, 0), (0, -1), HexColor('#1a7a6e')),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e0e0e0')),
        ('PADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 0.4*inch))
    
    # Questions and Answers
    story.append(Paragraph("Questions & Responses", heading_style))
    
    for i, answer in enumerate(run_audit.get("answers", [])):
        question = question_map.get(answer.get("question_id"), {})
        question_text = question.get("text", "Question not found")
        
        # Question box
        q_data = [
            [Paragraph(f"<b>Q{i+1}:</b> {question_text}", normal_style)],
            [Paragraph(f"<b>Response:</b> {answer.get('response_label', 'N/A')}", normal_style)],
        ]
        
        if answer.get("score") is not None:
            q_data.append([Paragraph(f"<b>Score:</b> {answer.get('score')}", normal_style)])
        
        if answer.get("notes"):
            q_data.append([Paragraph(f"<b>Comment:</b> {answer.get('notes')}", normal_style)])

        if answer.get("is_negative") and answer.get("action_required"):
            assigned_to = answer.get("assigned_user_name") or answer.get("assigned_department") or "Unassigned"
            q_data.extend([
                [Paragraph(f"<b>Action Required:</b> {answer.get('action_required')}", normal_style)],
                [Paragraph(f"<b>Assigned To:</b> {assigned_to}", normal_style)],
                [Paragraph(f"<b>Due Date:</b> {answer.get('action_due_date', 'N/A')}", normal_style)],
            ])
            if answer.get("action_taken"):
                q_data.append([Paragraph(f"<b>Action Taken:</b> {answer.get('action_taken')}", normal_style)])
        
        if answer.get("photos"):
            q_data.append([Paragraph(f"<b>Photos:</b> {len(answer.get('photos', []))} attached", normal_style)])
        
        # Color based on negative response
        bg_color = HexColor('#ffebee') if answer.get("is_negative") else HexColor('#e8f5e9')
        
        q_table = Table(q_data, colWidths=[6*inch])
        q_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), bg_color),
            ('BOX', (0, 0), (-1, -1), 1, HexColor('#cccccc')),
            ('PADDING', (0, 0), (-1, -1), 10),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        story.append(q_table)
        story.append(Spacer(1, 0.15*inch))
    
    # General notes
    if run_audit.get("notes"):
        story.append(Spacer(1, 0.2*inch))
        story.append(Paragraph("General Notes", heading_style))
        story.append(Paragraph(run_audit.get("notes"), normal_style))
    
    # Sign-off section
    if run_audit.get("signoff_name"):
        story.append(Spacer(1, 0.3*inch))
        story.append(Paragraph("Sign Off", heading_style))
        signoff_data = [
            ["Signed by:", run_audit.get("signoff_name", "N/A")],
            ["Email:", run_audit.get("signoff_email", "N/A")],
        ]
        signoff_table = Table(signoff_data, colWidths=[2*inch, 4*inch])
        signoff_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), HexColor('#f0f9f8')),
            ('TEXTCOLOR', (0, 0), (0, -1), HexColor('#1a7a6e')),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e0e0e0')),
            ('PADDING', (0, 0), (-1, -1), 8),
        ]))
        story.append(signoff_table)
        
        # Add signature image if available
        if run_audit.get("signature") and run_audit["signature"].startswith("data:image"):
            try:
                sig_data = run_audit["signature"].split(",", 1)[1]
                sig_bytes = base64.b64decode(sig_data)
                sig_buffer = io.BytesIO(sig_bytes)
                sig_img = RLImage(sig_buffer, width=3*inch, height=1*inch)
                story.append(Spacer(1, 0.1*inch))
                story.append(sig_img)
            except Exception:
                pass
    
    # Footer
    story.append(Spacer(1, 0.5*inch))
    footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontSize=8, textColor=grey, alignment=TA_CENTER)
    story.append(Paragraph(f"Generated by Infinit-Audit on {format_uk_datetime(get_uk_time_iso())}", footer_style))
    story.append(Paragraph("www.infinit-audit.co.uk", footer_style))
    
    doc.build(story)
    buffer.seek(0)
    
    filename = f"audit_report_{run_audit['audit_name'].replace(' ', '_')}_{datetime.now().strftime('%Y%m%d')}.pdf"
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# ==================== BULK USER IMPORT ====================

@api_router.post("/users/bulk-import")
async def bulk_import_users(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Import users from CSV file. Expected columns: email, name, role, company_id (optional)"""
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    
    content = await file.read()
    decoded = content.decode('utf-8')
    
    reader = csv.DictReader(io.StringIO(decoded))
    
    results = {"success": 0, "failed": 0, "errors": []}
    
    for row_num, row in enumerate(reader, start=2):
        try:
            email = row.get('email', '').strip()
            name = row.get('name', '').strip()
            role = row.get('role', 'user').strip().lower()
            company_id = row.get('company_id', '').strip() or None
            password = row.get('password', 'TempPass123!').strip()
            
            if not email or not name:
                results["errors"].append(f"Row {row_num}: Missing email or name")
                results["failed"] += 1
                continue
            
            # Check if email exists
            existing = await db.users.find_one({"email": email})
            if existing:
                results["errors"].append(f"Row {row_num}: Email {email} already exists")
                results["failed"] += 1
                continue
            
            # Validate role
            valid_roles = ['system_admin', 'company_admin', 'admin', 'audit_creator', 'user']
            if role not in valid_roles:
                role = 'user'
            
            # Non-system-admins can only import users to their own company
            if not is_system_admin(user):
                if role == 'system_admin':
                    results["errors"].append(f"Row {row_num}: Cannot create system administrators")
                    results["failed"] += 1
                    continue
                if company_id and company_id != user.get("company_id"):
                    results["errors"].append(f"Row {row_num}: Cannot assign users to other companies")
                    results["failed"] += 1
                    continue
                # Force company_id to current user's company
                company_id = user.get("company_id")
            
            # Validate company if provided
            if company_id:
                company = await db.companies.find_one({"id": company_id})
                if not company:
                    results["errors"].append(f"Row {row_num}: Company ID {company_id} not found")
                    results["failed"] += 1
                    continue
            
            user_id = str(uuid.uuid4())
            user_doc = {
                "id": user_id,
                "email": email,
                "password": hash_password(password),
                "name": name,
                "role": role,
                "company_id": company_id,
                "feature_access": normalise_feature_access({"role": role}),
                "created_at": get_uk_time_iso()
            }
            await db.users.insert_one(user_doc)
            results["success"] += 1
            
        except Exception as e:
            results["errors"].append(f"Row {row_num}: {str(e)}")
            results["failed"] += 1
    
    return results

@api_router.get("/users/export-template")
async def get_user_import_template(user: dict = Depends(get_current_user)):
    """Download CSV template for bulk user import"""
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['email', 'name', 'role', 'company_id', 'password'])
    writer.writerow(['john@example.com', 'John Doe', 'user', '', 'TempPass123!'])
    writer.writerow(['jane@example.com', 'Jane Smith', 'audit_creator', 'company-id-here', 'SecurePass456!'])
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=user_import_template.csv"}
    )

# ==================== AUDIT SCHEDULING ====================

class ScheduledAuditCreate(BaseModel):
    audit_id: str
    assigned_to: str  # User ID
    scheduled_date: str  # ISO date
    location: Optional[str] = None
    notes: Optional[str] = None
    reminder_days: int = 1  # Days before to send reminder

class ScheduledAuditResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    audit_id: str
    audit_name: str
    assigned_to: str
    assigned_to_name: str
    assigned_to_email: str
    scheduled_date: str
    location: Optional[str]
    notes: Optional[str]
    reminder_days: int
    status: str  # pending, completed, overdue
    created_by: str
    created_at: str
    completed_run_id: Optional[str] = None

@api_router.post("/scheduled-audits", response_model=ScheduledAuditResponse)
async def create_scheduled_audit(
    schedule_data: ScheduledAuditCreate,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "audits"))
):
    # Validate audit exists
    audit = await db.audits.find_one({"id": schedule_data.audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
    
    # Validate assigned user exists
    assigned_user = await db.users.find_one({"id": schedule_data.assigned_to}, {"_id": 0, "password": 0})
    if not assigned_user:
        raise HTTPException(status_code=404, detail="Assigned user not found")
    
    # Company admin can only schedule for users in their company
    if not is_system_admin(user):
        if assigned_user.get("company_id") != user.get("company_id"):
            raise HTTPException(status_code=403, detail="Cannot schedule audits for users from other companies")
    
    schedule_id = str(uuid.uuid4())
    schedule_doc = {
        "id": schedule_id,
        "audit_id": schedule_data.audit_id,
        "audit_name": audit["name"],
        "assigned_to": schedule_data.assigned_to,
        "assigned_to_name": assigned_user["name"],
        "assigned_to_email": assigned_user["email"],
        "scheduled_date": schedule_data.scheduled_date,
        "location": schedule_data.location,
        "notes": schedule_data.notes,
        "reminder_days": schedule_data.reminder_days,
        "status": "pending",
        "created_by": user["id"],
        "created_at": get_uk_time_iso(),
        "completed_run_id": None
    }
    await db.scheduled_audits.insert_one(schedule_doc)
    return ScheduledAuditResponse(**schedule_doc)

@api_router.get("/scheduled-audits", response_model=List[ScheduledAuditResponse])
async def get_scheduled_audits(
    status: Optional[str] = None,
    user: dict = Depends(require_feature("audits"))
):
    query = {}
    
    # Filter by user role
    if user["role"] == UserRole.USER:
        query["assigned_to"] = user["id"]
    
    if status:
        query["status"] = status
    
    schedules = await db.scheduled_audits.find(query, {"_id": 0}).sort("scheduled_date", 1).to_list(1000)
    
    # Update overdue status
    now = get_uk_time()
    for schedule in schedules:
        if schedule["status"] == "pending":
            scheduled_date = datetime.fromisoformat(schedule["scheduled_date"].replace('Z', '+00:00'))
            if scheduled_date.date() < now.date():
                schedule["status"] = "overdue"
                await db.scheduled_audits.update_one({"id": schedule["id"]}, {"$set": {"status": "overdue"}})
    
    return [ScheduledAuditResponse(**s) for s in schedules]

@api_router.get("/scheduled-audits/my-schedule", response_model=List[ScheduledAuditResponse])
async def get_my_scheduled_audits(user: dict = Depends(require_feature("audits"))):
    """Get scheduled audits for the current user"""
    schedules = await db.scheduled_audits.find(
        {"assigned_to": user["id"], "status": {"$in": ["pending", "overdue"]}},
        {"_id": 0}
    ).sort("scheduled_date", 1).to_list(100)
    
    return [ScheduledAuditResponse(**s) for s in schedules]

@api_router.put("/scheduled-audits/{schedule_id}/complete")
async def complete_scheduled_audit(
    schedule_id: str,
    run_id: str,
    user: dict = Depends(require_feature("audits"))
):
    """Mark a scheduled audit as completed with the run audit ID"""
    schedule = await db.scheduled_audits.find_one({"id": schedule_id}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail="Scheduled audit not found")
    
    if schedule["assigned_to"] != user["id"] and user["role"] not in [UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    await db.scheduled_audits.update_one(
        {"id": schedule_id},
        {"$set": {"status": "completed", "completed_run_id": run_id}}
    )
    
    return {"message": "Scheduled audit marked as completed"}

@api_router.delete("/scheduled-audits/{schedule_id}")
async def delete_scheduled_audit(
    schedule_id: str,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "audits"))
):
    result = await db.scheduled_audits.delete_one({"id": schedule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Scheduled audit not found")
    return {"message": "Scheduled audit deleted"}

# ==================== COMPANY DASHBOARD ====================

@api_router.get("/companies/{company_id}/dashboard")
async def get_company_dashboard(company_id: str, user: dict = Depends(require_feature("audits"))):
    """Get company-specific dashboard with compliance trends"""
    # Verify access
    if user["role"] != UserRole.ADMIN and user.get("company_id") != company_id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    # Get company users
    company_users = await db.users.find({"company_id": company_id}, {"_id": 0, "password": 0}).to_list(1000)
    user_ids = [u["id"] for u in company_users]
    
    # Get company stats
    total_audits = await db.audits.count_documents({"company_id": company_id})
    total_runs = await db.run_audits.count_documents({"auditor_id": {"$in": user_ids}})
    completed_runs = await db.run_audits.count_documents({"auditor_id": {"$in": user_ids}, "completed": True})
    passed_runs = await db.run_audits.count_documents({"auditor_id": {"$in": user_ids}, "pass_status": "pass"})
    failed_runs = await db.run_audits.count_documents({"auditor_id": {"$in": user_ids}, "pass_status": "fail"})
    
    pass_rate = (passed_runs / completed_runs * 100) if completed_runs > 0 else 0
    
    # Get monthly trend data (last 6 months)
    now = get_uk_time()
    trends = []
    for i in range(5, -1, -1):
        month_start = (now.replace(day=1) - timedelta(days=i*30)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if i > 0:
            month_end = (month_start + timedelta(days=32)).replace(day=1) - timedelta(seconds=1)
        else:
            month_end = now
        
        month_runs = await db.run_audits.find({
            "auditor_id": {"$in": user_ids},
            "completed": True,
            "completed_at": {"$gte": month_start.isoformat(), "$lte": month_end.isoformat()}
        }, {"_id": 0}).to_list(1000)
        
        month_passed = len([r for r in month_runs if r.get("pass_status") == "pass"])
        month_total = len(month_runs)
        month_rate = (month_passed / month_total * 100) if month_total > 0 else 0
        
        trends.append({
            "month": month_start.strftime("%b %Y"),
            "completed": month_total,
            "passed": month_passed,
            "failed": month_total - month_passed,
            "pass_rate": round(month_rate, 1)
        })
    
    # Get pending/overdue scheduled audits
    pending_schedules = await db.scheduled_audits.count_documents({
        "assigned_to": {"$in": user_ids},
        "status": "pending"
    })
    overdue_schedules = await db.scheduled_audits.count_documents({
        "assigned_to": {"$in": user_ids},
        "status": "overdue"
    })
    
    # Get recent activity
    recent_runs = await db.run_audits.find(
        {"auditor_id": {"$in": user_ids}, "completed": True},
        {"_id": 0}
    ).sort("completed_at", -1).limit(5).to_list(5)
    
    return {
        "company": company,
        "stats": {
            "total_users": len(company_users),
            "total_audits": total_audits,
            "total_runs": total_runs,
            "completed_runs": completed_runs,
            "passed_runs": passed_runs,
            "failed_runs": failed_runs,
            "pass_rate": round(pass_rate, 1),
            "pending_schedules": pending_schedules,
            "overdue_schedules": overdue_schedules
        },
        "trends": trends,
        "recent_activity": recent_runs
    }

@api_router.get("/")
async def root():
    return {"message": "Infinit-Audit API", "version": "1.2.0"}

@api_router.get("/health")
async def health():
    if not await db.ping():
        raise HTTPException(status_code=503, detail="Database unavailable")
    return {"status": "healthy", "database": "postgresql"}

# ==================== TRACEABILITY RECORDS ====================

TRACEABILITY_COLLECTIONS = {
    kind: db.collection(schema["collection"])
    for kind, schema in TRACEABILITY_SCHEMAS.items()
}


def _traceability_company_query(user: dict) -> dict:
    return {} if is_system_admin(user) else {"company_id": user.get("company_id")}


def _traceability_config_query(user: dict) -> dict:
    return {"company_id": user.get("company_id")}


def _clean_traceability_config(values: dict) -> dict:
    cleaned = {}
    for field in ("itemTypes", "packagingTypes"):
        source = values[field] if field in values else TRACEABILITY_DEFAULT_CONFIG[field]
        cleaned[field] = list(dict.fromkeys(str(value).strip() for value in source if str(value).strip()))
    return cleaned


async def _get_traceability_config(user: dict) -> dict:
    config = await db.traceability_config.find_one(_traceability_config_query(user), {"_id": 0})
    return _clean_traceability_config(config or TRACEABILITY_DEFAULT_CONFIG)


async def _get_traceability_records(user: dict) -> dict:
    query = _traceability_company_query(user)
    response = {}
    for record_type, schema in TRACEABILITY_SCHEMAS.items():
        response[schema["response_key"]] = await TRACEABILITY_COLLECTIONS[record_type].find(
            query, {"_id": 0}
        ).sort("created_at", -1).to_list(10_000)
    response["config"] = await _get_traceability_config(user)
    return response


@api_router.get("/traceability/records")
async def get_traceability_records(user: dict = Depends(require_feature("traceability"))):
    return await _get_traceability_records(user)


@api_router.put("/traceability/config")
async def update_traceability_config(
    data: TraceabilityConfigUpdate,
    user: dict = Depends(require_feature("traceability")),
):
    values = _clean_traceability_config(data.model_dump())
    query = _traceability_config_query(user)
    existing = await db.traceability_config.find_one(query, {"_id": 0})
    now = get_uk_time_iso()
    if existing:
        await db.traceability_config.update_one(
            {"id": existing["id"]}, {"$set": {**values, "updated_at": now}}
        )
    else:
        await db.traceability_config.insert_one({
            "id": str(uuid.uuid4()), **values, "company_id": user.get("company_id"),
            "created_by": user["id"], "created_at": now, "updated_at": now,
        })
    return values


@api_router.post("/traceability/records/migrate-local")
async def migrate_local_traceability_records(
    data: dict,
    user: dict = Depends(require_feature("traceability")),
):
    """Seed the shared store once from a user's legacy browser-only records."""
    query = _traceability_company_query(user)
    existing_count = sum(
        [await collection.count_documents(query) for collection in TRACEABILITY_COLLECTIONS.values()]
    )
    if existing_count:
        return {"migrated": False, "reason": "Shared traceability data already exists", **(await _get_traceability_records(user))}

    now = get_uk_time_iso()
    source_keys = {"raw": "rawIntakes", "finished": "finishedBatches", "usage": "materialUsage"}
    migrated = 0
    for record_type, source_key in source_keys.items():
        for source in (data.get(source_key) or [])[:10_000]:
            try:
                record = normalise_record(record_type, source)
            except ValueError:
                continue
            record.update({
                "id": str(uuid.uuid4()), "company_id": user.get("company_id"),
                "created_by": user["id"], "created_at": now, "updated_at": now,
            })
            await TRACEABILITY_COLLECTIONS[record_type].insert_one(record)
            migrated += 1

    if data.get("config"):
        config = _clean_traceability_config(data["config"])
        await db.traceability_config.insert_one({
            "id": str(uuid.uuid4()), **config, "company_id": user.get("company_id"),
            "created_by": user["id"], "created_at": now, "updated_at": now,
        })
    return {"migrated": True, "migrated_count": migrated, **(await _get_traceability_records(user))}


@api_router.post("/traceability/records/{record_type}")
async def create_traceability_record(
    record_type: str,
    data: dict,
    user: dict = Depends(require_feature("traceability")),
):
    if record_type not in TRACEABILITY_SCHEMAS:
        raise HTTPException(status_code=400, detail="Unknown traceability record type")
    try:
        record = normalise_record(record_type, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    now = get_uk_time_iso()
    record.update({
        "id": str(uuid.uuid4()), "company_id": user.get("company_id"),
        "created_by": user["id"], "created_at": now, "updated_at": now,
    })
    await TRACEABILITY_COLLECTIONS[record_type].insert_one(record)
    return record


@api_router.delete("/traceability/records/{record_type}/{record_id}")
async def delete_traceability_record(
    record_type: str,
    record_id: str,
    user: dict = Depends(require_feature("traceability")),
):
    if record_type not in TRACEABILITY_SCHEMAS:
        raise HTTPException(status_code=400, detail="Unknown traceability record type")
    record = await TRACEABILITY_COLLECTIONS[record_type].find_one({"id": record_id}, {"_id": 0})
    if not record or not can_access_company_record(user, record):
        raise HTTPException(status_code=404, detail="Traceability record not found")
    await TRACEABILITY_COLLECTIONS[record_type].delete_one({"id": record_id})
    return {"message": "Traceability record deleted"}


@api_router.post("/traceability/bulk-export")
async def export_traceability_excel(
    data: TraceabilityBulkExport,
    user: dict = Depends(require_feature("traceability")),
):
    selected = list(dict.fromkeys(data.data_types))
    unknown = [kind for kind in selected if kind not in TRACEABILITY_SCHEMAS]
    if unknown or not selected:
        raise HTTPException(status_code=400, detail="Select at least one valid traceability data type")
    try:
        date_from = date.fromisoformat(data.date_from) if data.date_from else None
        date_to = date.fromisoformat(data.date_to) if data.date_to else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Export dates must be valid") from exc
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="Start date cannot be after end date")

    query = _traceability_company_query(user)
    records_by_type = {}
    for record_type in selected:
        schema = TRACEABILITY_SCHEMAS[record_type]
        records = await TRACEABILITY_COLLECTIONS[record_type].find(query, {"_id": 0}).sort(
            schema["date_field"], 1
        ).to_list(10_000)
        if date_from or date_to:
            filtered = []
            for record in records:
                try:
                    record_date = date.fromisoformat(str(record.get(schema["date_field"], ""))[:10])
                except ValueError:
                    continue
                if date_from and record_date < date_from:
                    continue
                if date_to and record_date > date_to:
                    continue
                filtered.append(record)
            records = filtered
        records_by_type[record_type] = records

    workbook = build_traceability_workbook(records_by_type, await _get_traceability_config(user), selected)
    filename = f"traceability_bulk_{get_uk_time().date().isoformat()}.xlsx"
    return StreamingResponse(
        io.BytesIO(workbook),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.post("/traceability/bulk-import")
async def import_traceability_excel(
    file: UploadFile = File(...),
    user: dict = Depends(require_feature("traceability")),
):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Upload an .xlsx Excel workbook")
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Workbook must be 5 MB or smaller")
    if not content.startswith(b"PK"):
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid .xlsx workbook")
    try:
        parsed = parse_traceability_workbook(content)
    except Exception as exc:
        logger.warning("Traceability workbook rejected: %s", exc)
        raise HTTPException(status_code=400, detail=f"Unable to read workbook: {exc}") from exc

    imported = {kind: 0 for kind in TRACEABILITY_SCHEMAS}
    skipped = 0
    errors = []
    now = get_uk_time_iso()
    for record_type, records in parsed.items():
        sheet = TRACEABILITY_SCHEMAS[record_type]["sheet"]
        for record in records:
            if record.get("__error__"):
                errors.append({"sheet": sheet, "row": record["__row__"], "message": record["__error__"]})
                continue
            supplied_id = record.pop("id", None)
            row_number = record.pop("__row__", None)
            if supplied_id:
                existing = await TRACEABILITY_COLLECTIONS[record_type].find_one({"id": supplied_id}, {"_id": 0})
                if existing:
                    skipped += 1
                else:
                    errors.append({
                        "sheet": sheet, "row": row_number,
                        "message": "Record ID was not recognised. Leave Record ID blank for a new row.",
                    })
                continue
            record.update({
                "id": str(uuid.uuid4()), "company_id": user.get("company_id"),
                "created_by": user["id"], "created_at": now, "updated_at": now,
            })
            await TRACEABILITY_COLLECTIONS[record_type].insert_one(record)
            imported[record_type] += 1

    return {
        "imported": imported,
        "imported_total": sum(imported.values()),
        "skipped": skipped,
        "failed": len(errors),
        "errors": errors[:200],
    }


# ==================== TRACEABILITY DOCUMENTS ====================

class TraceabilityFieldCreate(BaseModel):
    label: str
    field_type: str = "text"  # text, number, time, date, checkbox, dropdown, blank
    section: str = "header"  # "header" or "table"
    required: bool = False
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    dropdown_options: Optional[List[str]] = None
    order: int = 0

class TraceabilityTemplateCreate(BaseModel):
    title: str
    document_reference: str
    fields: List[TraceabilityFieldCreate] = []

class TraceabilityTemplateUpdate(BaseModel):
    title: Optional[str] = None
    document_reference: Optional[str] = None
    fields: Optional[List[TraceabilityFieldCreate]] = None

class TraceabilityDocumentSubmit(BaseModel):
    field_values: List[Dict[str, Any]]
    table_rows: Optional[List[Dict[str, Any]]] = []
    completed: bool = False

# --- Template CRUD ---

@api_router.post("/traceability/templates")
async def create_traceability_template(
    data: TraceabilityTemplateCreate,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "documents"))
):
    template_id = str(uuid.uuid4())
    now = get_uk_time_iso()
    fields = []
    for i, f in enumerate(data.fields):
        fields.append({
            "id": str(uuid.uuid4()),
            "label": f.label,
            "field_type": f.field_type,
            "section": f.section,
            "required": f.required,
            "min_length": f.min_length,
            "max_length": f.max_length,
            "min_value": f.min_value,
            "max_value": f.max_value,
            "dropdown_options": f.dropdown_options,
            "order": i
        })
    doc = {
        "id": template_id,
        "title": data.title,
        "document_reference": data.document_reference,
        "version": 1,
        "authorised_by": user["name"],
        "authorised_by_id": user["id"],
        "fields": fields,
        "company_id": user.get("company_id"),
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now
    }
    await db.traceability_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.get("/traceability/templates")
async def get_traceability_templates(user: dict = Depends(require_feature("documents"))):
    if is_system_admin(user):
        query = {}
    else:
        query = {"$or": [{"company_id": user.get("company_id")}, {"company_id": None}]}
    templates = await db.traceability_templates.find(query, {"_id": 0}).sort("updated_at", -1).to_list(1000)
    return templates

@api_router.get("/traceability/templates/{template_id}")
async def get_traceability_template(template_id: str, user: dict = Depends(require_feature("documents"))):
    t = await db.traceability_templates.find_one({"id": template_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return t

@api_router.put("/traceability/templates/{template_id}")
async def update_traceability_template(
    template_id: str,
    data: TraceabilityTemplateUpdate,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "documents"))
):
    t = await db.traceability_templates.find_one({"id": template_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    update = {"updated_at": get_uk_time_iso(), "version": t["version"] + 1, "authorised_by": user["name"], "authorised_by_id": user["id"]}
    if data.title is not None:
        update["title"] = data.title
    if data.document_reference is not None:
        update["document_reference"] = data.document_reference
    if data.fields is not None:
        fields = []
        for i, f in enumerate(data.fields):
            fields.append({
                "id": str(uuid.uuid4()),
                "label": f.label,
                "field_type": f.field_type,
                "section": f.section,
                "required": f.required,
                "min_length": f.min_length,
                "max_length": f.max_length,
                "min_value": f.min_value,
                "max_value": f.max_value,
                "dropdown_options": f.dropdown_options,
                "order": i
            })
        update["fields"] = fields
    await db.traceability_templates.update_one({"id": template_id}, {"$set": update})
    updated = await db.traceability_templates.find_one({"id": template_id}, {"_id": 0})
    return updated

@api_router.delete("/traceability/templates/{template_id}")
async def delete_traceability_template(
    template_id: str,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN], "documents"))
):
    result = await db.traceability_templates.delete_one({"id": template_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"message": "Template deleted"}

# --- Document CRUD ---

@api_router.post("/traceability/documents")
async def create_traceability_document(data: dict, user: dict = Depends(require_feature("documents"))):
    template_id = data.get("template_id")
    t = await db.traceability_templates.find_one({"id": template_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    doc_id = str(uuid.uuid4())
    now = get_uk_time_iso()
    doc = {
        "id": doc_id,
        "template_id": template_id,
        "template_title": t["title"],
        "document_reference": t["document_reference"],
        "version": t["version"],
        "authorised_by": t["authorised_by"],
        "fields": t["fields"],
        "completed_by": user["id"],
        "completed_by_name": user["name"],
        "field_values": [],
        "company_id": user.get("company_id"),
        "completed": False,
        "created_at": now,
        "completed_at": None,
        "table_rows": []
    }
    await db.traceability_documents.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/traceability/documents/{doc_id}")
async def update_traceability_document(doc_id: str, data: TraceabilityDocumentSubmit, user: dict = Depends(require_feature("documents"))):
    doc = await db.traceability_documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    update = {"field_values": data.field_values, "table_rows": data.table_rows or [], "completed": data.completed}
    if data.completed:
        update["completed_at"] = get_uk_time_iso()
    await db.traceability_documents.update_one({"id": doc_id}, {"$set": update})
    updated = await db.traceability_documents.find_one({"id": doc_id}, {"_id": 0})
    return updated

@api_router.get("/traceability/documents")
async def get_traceability_documents(template_id: Optional[str] = None, user: dict = Depends(require_feature("documents"))):
    query = {}
    if user["role"] == UserRole.USER:
        query["completed_by"] = user["id"]
    if template_id:
        query["template_id"] = template_id
    docs = await db.traceability_documents.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs

@api_router.get("/traceability/documents/{doc_id}")
async def get_traceability_document(doc_id: str, user: dict = Depends(require_feature("documents"))):
    doc = await db.traceability_documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

@api_router.delete("/traceability/documents/{doc_id}")
async def delete_traceability_document(doc_id: str, user: dict = Depends(require_feature("documents"))):
    doc = await db.traceability_documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc["completed_by"] != user["id"] and not is_admin(user):
        raise HTTPException(status_code=403, detail="Access denied")
    await db.traceability_documents.delete_one({"id": doc_id})
    return {"message": "Document deleted"}

@api_router.get("/traceability/documents/{doc_id}/pdf")
async def export_traceability_document_pdf(doc_id: str, user: dict = Depends(require_feature("documents"))):
    doc = await db.traceability_documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    buffer = io.BytesIO()
    pdf_doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=1.5*cm, leftMargin=1.5*cm, topMargin=2*cm, bottomMargin=2.5*cm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('DocTitle', parent=styles['Heading1'], fontSize=22, textColor=HexColor('#1a7a6e'), alignment=TA_CENTER, spaceAfter=20)
    heading_style = ParagraphStyle('FieldLabel', parent=styles['Normal'], fontSize=10, textColor=HexColor('#666666'), spaceBefore=8)
    value_style = ParagraphStyle('FieldValue', parent=styles['Normal'], fontSize=12, spaceBefore=2, spaceAfter=6)

    story = []
    story.append(Paragraph(doc["template_title"], title_style))
    story.append(Spacer(1, 0.3*inch))

    # Build field map
    field_map = {f["id"]: f for f in doc.get("fields", [])}
    header_fields = [f for f in doc.get("fields", []) if f.get("section") != "table"]
    table_fields = sorted([f for f in doc.get("fields", []) if f.get("section") == "table"], key=lambda x: x.get("order", 0))

    # Header fields
    for fv in doc.get("field_values", []):
        field = field_map.get(fv.get("field_id"), {})
        if field.get("section") == "table":
            continue
        label = field.get("label", fv.get("field_id", ""))
        val = fv.get("value", "")
        if field.get("field_type") == "checkbox":
            val = "Yes" if val else "No"
        story.append(Paragraph(f"<b>{label}</b>", heading_style))
        story.append(Paragraph(str(val) if val else "-", value_style))

    # Table section
    if table_fields and doc.get("table_rows"):
        story.append(Spacer(1, 0.3*inch))
        story.append(Paragraph("<b>Production Data</b>", heading_style))
        story.append(Spacer(1, 0.1*inch))
        col_count = len(table_fields)
        col_width = (6*inch) / max(col_count, 1)
        tbl_data = [["#"] + [f["label"] for f in table_fields]]
        for ri, row in enumerate(doc["table_rows"]):
            row_vals = [str(ri + 1)]
            for f in table_fields:
                val = row.get(f["id"], "")
                if f["field_type"] == "checkbox":
                    val = "Yes" if val else "No"
                row_vals.append(str(val) if val else "-")
            tbl_data.append(row_vals)
        tbl = Table(tbl_data, colWidths=[0.4*inch] + [col_width]*col_count)
        tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), HexColor('#1a7a6e')),
            ('TEXTCOLOR', (0, 0), (-1, 0), white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#cccccc')),
            ('PADDING', (0, 0), (-1, -1), 4),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#f8f8f8')]),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(tbl)

    # Footer info
    story.append(Spacer(1, 0.5*inch))
    footer_data = [
        ["Date:", format_uk_datetime(doc.get("completed_at") or doc.get("created_at"))],
        ["Version:", str(doc.get("version", 1))],
        ["Document Ref:", doc.get("document_reference", "N/A")],
        ["Authorised By:", doc.get("authorised_by", "N/A")],
        ["Completed By:", doc.get("completed_by_name", "N/A")],
    ]
    ft = Table(footer_data, colWidths=[2*inch, 4*inch])
    ft.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), HexColor('#f0f9f8')),
        ('TEXTCOLOR', (0, 0), (0, -1), HexColor('#1a7a6e')),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e0e0e0')),
        ('PADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(ft)

    footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontSize=8, textColor=grey, alignment=TA_CENTER)
    story.append(Spacer(1, 0.3*inch))
    story.append(Paragraph("www.infinit-audit.co.uk", footer_style))

    pdf_doc.build(story)
    buffer.seek(0)
    filename = f"{doc['document_reference']}_{doc['template_title'].replace(' ', '_')}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})

@api_router.post("/traceability/documents/batch-pdf")
async def batch_export_traceability_pdf(data: dict, user: dict = Depends(require_feature("documents"))):
    """Combine multiple completed documents into a single PDF"""
    doc_ids = data.get("document_ids", [])
    if not doc_ids:
        raise HTTPException(status_code=400, detail="No document IDs provided")

    docs = []
    for did in doc_ids:
        doc = await db.traceability_documents.find_one({"id": did, "completed": True}, {"_id": 0})
        if doc:
            docs.append(doc)
    if not docs:
        raise HTTPException(status_code=404, detail="No completed documents found")

    buffer = io.BytesIO()
    pdf_doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=1.5*cm, leftMargin=1.5*cm, topMargin=2*cm, bottomMargin=2.5*cm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('BTitle', parent=styles['Heading1'], fontSize=22, textColor=HexColor('#1a7a6e'), alignment=TA_CENTER, spaceAfter=20)
    heading_style = ParagraphStyle('BLabel', parent=styles['Normal'], fontSize=10, textColor=HexColor('#666666'), spaceBefore=8)
    value_style = ParagraphStyle('BValue', parent=styles['Normal'], fontSize=12, spaceBefore=2, spaceAfter=6)
    sep_style = ParagraphStyle('BSep', parent=styles['Normal'], fontSize=8, textColor=grey, alignment=TA_CENTER)

    story = []
    for i, doc in enumerate(docs):
        if i > 0:
            from reportlab.platypus import PageBreak
            story.append(PageBreak())

        story.append(Paragraph(doc["template_title"], title_style))
        story.append(Spacer(1, 0.3*inch))

        field_map = {f["id"]: f for f in doc.get("fields", [])}
        for fv in doc.get("field_values", []):
            field = field_map.get(fv.get("field_id"), {})
            label = field.get("label", fv.get("field_id", ""))
            val = fv.get("value", "")
            if field.get("field_type") == "checkbox":
                val = "Yes" if val else "No"
            story.append(Paragraph(f"<b>{label}</b>", heading_style))
            story.append(Paragraph(str(val) if val else "-", value_style))

        story.append(Spacer(1, 0.5*inch))
        footer_data = [
            ["Date:", format_uk_datetime(doc.get("completed_at") or doc.get("created_at"))],
            ["Version:", str(doc.get("version", 1))],
            ["Document Ref:", doc.get("document_reference", "N/A")],
            ["Authorised By:", doc.get("authorised_by", "N/A")],
            ["Completed By:", doc.get("completed_by_name", "N/A")],
        ]
        ft = Table(footer_data, colWidths=[2*inch, 4*inch])
        ft.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), HexColor('#f0f9f8')),
            ('TEXTCOLOR', (0, 0), (0, -1), HexColor('#1a7a6e')),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e0e0e0')),
            ('PADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(ft)

    pdf_doc.build(story)
    buffer.seek(0)
    filename = f"batch_documents_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})

@api_router.post("/traceability/templates/{template_id}/duplicate")
async def duplicate_traceability_template(
    template_id: str,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR], "documents"))
):
    """Clone an existing template"""
    t = await db.traceability_templates.find_one({"id": template_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    new_id = str(uuid.uuid4())
    now = get_uk_time_iso()
    new_fields = []
    for f in t.get("fields", []):
        new_fields.append({**f, "id": str(uuid.uuid4())})

    new_doc = {
        "id": new_id,
        "title": f"Copy of {t['title']}",
        "document_reference": f"{t['document_reference']}-COPY",
        "version": 1,
        "authorised_by": user["name"],
        "authorised_by_id": user["id"],
        "fields": new_fields,
        "company_id": user.get("company_id"),
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now
    }
    await db.traceability_templates.insert_one(new_doc)
    new_doc.pop("_id", None)
    return new_doc

# Include router and configure CORS
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    await db.connect()
    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.audits.create_index("id", unique=True)
    await db.response_groups.create_index("id", unique=True)
    await db.audit_types.create_index("id", unique=True)
    await db.run_audits.create_index("id", unique=True)
    await db.scheduled_audits.create_index("id", unique=True)
    await db.companies.create_index("id", unique=True)
    await db.lines_shifts.create_index("id", unique=True)
    await db.traceability_templates.create_index("id", unique=True)
    await db.traceability_documents.create_index("id", unique=True)
    await db.corrective_actions.create_index("id", unique=True)
    await db.traceability_raw_intakes.create_index("id", unique=True)
    await db.traceability_finished_batches.create_index("id", unique=True)
    await db.traceability_material_usage.create_index("id", unique=True)
    await db.traceability_config.create_index("id", unique=True)
    
    # Optionally create the first system admin from deployment secrets.
    # Existing administrators and passwords are never reset on startup.
    bootstrap_admin_email = os.environ.get("BOOTSTRAP_ADMIN_EMAIL")
    bootstrap_admin_password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD")
    if bootstrap_admin_email and bootstrap_admin_password:
        admin = await db.users.find_one({"email": bootstrap_admin_email})
    else:
        admin = None

    if bootstrap_admin_email and bootstrap_admin_password and not admin:
        admin_doc = {
            "id": str(uuid.uuid4()),
            "email": bootstrap_admin_email,
            "password": hash_password(bootstrap_admin_password),
            "name": "System Admin",
            "role": UserRole.SYSTEM_ADMIN,
            "company_id": None,
            "feature_access": ADMIN_FEATURE_ACCESS.copy(),
            "created_at": get_uk_time_iso()
        }
        await db.users.insert_one(admin_doc)
        logger.info("Bootstrap system administrator created")

@app.on_event("shutdown")
async def shutdown_db_client():
    await db.close()
