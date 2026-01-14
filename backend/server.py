from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import io
import csv
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import bcrypt
import jwt
import base64
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.lib.colors import HexColor, black, white, grey
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

# UK Timezone
UK_TZ = ZoneInfo("Europe/London")

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET', 'infinit-audit-secret-key-2026')
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
    created_at: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None
    company_id: Optional[str] = None

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

class RunAuditCreate(BaseModel):
    audit_id: str
    location: Optional[str] = None
    line_shift_id: Optional[str] = None  # Optional line/shift selection

class RunAuditSubmit(BaseModel):
    answers: List[AnswerSubmit]
    notes: Optional[str] = None
    completed: bool = False

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

def require_role(allowed_roles: List[str]):
    async def role_checker(user: dict = Depends(get_current_user)):
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

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register", response_model=dict)
async def register(user_data: UserCreate):
    existing = await db.users.find_one({"email": user_data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": user_data.email,
        "password": hash_password(user_data.password),
        "name": user_data.name,
        "role": user_data.role,
        "company_id": user_data.company_id,
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
            "company_id": user_data.company_id
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
            "company_id": user.get("company_id")
        }
    }

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(user: dict = Depends(get_current_user)):
    # Get company name if assigned
    if user.get("company_id"):
        company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
        if company:
            user["company_name"] = company["name"]
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
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
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
async def get_response_groups(user: dict = Depends(get_current_user)):
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
async def get_response_group(group_id: str, user: dict = Depends(get_current_user)):
    group = await db.response_groups.find_one({"id": group_id}, {"_id": 0})
    if not group:
        raise HTTPException(status_code=404, detail="Response group not found")
    return ResponseGroupResponse(**group)

@api_router.delete("/response-groups/{group_id}")
async def delete_response_group(
    group_id: str,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
):
    result = await db.response_groups.delete_one({"id": group_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Response group not found")
    return {"message": "Response group deleted successfully"}

# ==================== AUDIT TYPES ====================

@api_router.post("/audit-types", response_model=AuditTypeResponse)
async def create_audit_type(
    type_data: AuditTypeCreate,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
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
async def get_audit_types(user: dict = Depends(get_current_user)):
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
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
):
    result = await db.audit_types.delete_one({"id": type_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Audit type not found")
    return {"message": "Audit type deleted successfully"}

# ==================== LINES/SHIFTS ====================

@api_router.post("/lines-shifts", response_model=LineShiftResponse)
async def create_line_shift(
    data: LineShiftCreate,
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN]))
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
async def get_lines_shifts(user: dict = Depends(get_current_user)):
    """Get all lines/shifts for user's company"""
    if is_system_admin(user):
        lines = await db.lines_shifts.find({}, {"_id": 0}).to_list(1000)
    else:
        # Show lines from same company
        query = {"company_id": user.get("company_id")} if user.get("company_id") else {"company_id": None}
        lines = await db.lines_shifts.find(query, {"_id": 0}).to_list(1000)
    return [LineShiftResponse(**l) for l in lines]

@api_router.get("/lines-shifts/{line_id}", response_model=LineShiftResponse)
async def get_line_shift(line_id: str, user: dict = Depends(get_current_user)):
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
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN]))
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
    user: dict = Depends(require_role([UserRole.SYSTEM_ADMIN, UserRole.COMPANY_ADMIN, UserRole.ADMIN]))
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
    user: dict = Depends(require_role([UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
):
    audit_id = str(uuid.uuid4())
    now = get_uk_time_iso()
    
    # Process questions
    questions = []
    for i, q in enumerate(audit_data.questions):
        question_doc = {
            "id": str(uuid.uuid4()),
            "text": q.text,
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
async def get_audits(user: dict = Depends(get_current_user)):
    # Admin sees all audits
    if user["role"] == UserRole.ADMIN:
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
async def get_audit(audit_id: str, user: dict = Depends(get_current_user)):
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
    user: dict = Depends(require_role([UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
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
    user: dict = Depends(require_role([UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
):
    result = await db.audits.delete_one({"id": audit_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Audit not found")
    return {"message": "Audit deleted successfully"}

# ==================== RUN AUDITS ====================

@api_router.post("/run-audits", response_model=RunAuditResponse)
async def start_run_audit(run_data: RunAuditCreate, user: dict = Depends(get_current_user)):
    audit = await db.audits.find_one({"id": run_data.audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
    
    run_id = str(uuid.uuid4())
    run_doc = {
        "id": run_id,
        "audit_id": run_data.audit_id,
        "audit_name": audit["name"],
        "auditor_id": user["id"],
        "auditor_name": user["name"],
        "company_id": user.get("company_id"),
        "location": run_data.location,
        "answers": [],
        "notes": None,
        "completed": False,
        "total_score": None,
        "pass_status": None,
        "started_at": get_uk_time_iso(),
        "completed_at": None
    }
    await db.run_audits.insert_one(run_doc)
    return RunAuditResponse(**run_doc)

@api_router.put("/run-audits/{run_id}", response_model=RunAuditResponse)
async def update_run_audit(run_id: str, submit_data: RunAuditSubmit, user: dict = Depends(get_current_user)):
    run_audit = await db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run_audit:
        raise HTTPException(status_code=404, detail="Run audit not found")
    if run_audit["auditor_id"] != user["id"] and user["role"] not in [UserRole.ADMIN, UserRole.AUDIT_CREATOR]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Validate that negative responses have comments
    answers = [a.model_dump() for a in submit_data.answers]
    for answer in answers:
        if answer.get("is_negative") and not answer.get("notes"):
            raise HTTPException(
                status_code=400, 
                detail=f"Comment required for negative/fail response on question"
            )
    
    # Calculate score if scoring enabled
    total_score = None
    pass_status = None
    
    if submit_data.completed:
        scores = [a["score"] for a in answers if a.get("score") is not None]
        if scores:
            total_score = sum(scores) / len(scores) * 100
            audit = await db.audits.find_one({"id": run_audit["audit_id"]}, {"_id": 0})
            if audit and audit.get("pass_rate"):
                pass_status = "pass" if total_score >= audit["pass_rate"] else "fail"
    
    update_dict = {
        "answers": answers,
        "notes": submit_data.notes,
        "completed": submit_data.completed,
        "total_score": total_score,
        "pass_status": pass_status
    }
    if submit_data.completed:
        update_dict["completed_at"] = get_uk_time_iso()
    
    await db.run_audits.update_one({"id": run_id}, {"$set": update_dict})
    updated = await db.run_audits.find_one({"id": run_id}, {"_id": 0})
    return RunAuditResponse(**updated)

@api_router.get("/run-audits", response_model=List[RunAuditResponse])
async def get_run_audits(
    completed: Optional[bool] = None,
    user: dict = Depends(get_current_user)
):
    query = {}
    if user["role"] == UserRole.USER:
        query["auditor_id"] = user["id"]
    if completed is not None:
        query["completed"] = completed
    
    runs = await db.run_audits.find(query, {"_id": 0}).sort("started_at", -1).to_list(1000)
    return [RunAuditResponse(**r) for r in runs]

@api_router.get("/run-audits/{run_id}", response_model=RunAuditResponse)
async def get_run_audit(run_id: str, user: dict = Depends(get_current_user)):
    run_audit = await db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run_audit:
        raise HTTPException(status_code=404, detail="Run audit not found")
    if run_audit["auditor_id"] != user["id"] and user["role"] not in [UserRole.ADMIN, UserRole.AUDIT_CREATOR]:
        raise HTTPException(status_code=403, detail="Access denied")
    return RunAuditResponse(**run_audit)

@api_router.get("/run-audits/{run_id}/details")
async def get_run_audit_details(run_id: str, user: dict = Depends(get_current_user)):
    """Get detailed run audit with full question text and answers"""
    run_audit = await db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run_audit:
        raise HTTPException(status_code=404, detail="Run audit not found")
    if run_audit["auditor_id"] != user["id"] and user["role"] not in [UserRole.ADMIN, UserRole.AUDIT_CREATOR]:
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

# ==================== PHOTO UPLOAD ====================

@api_router.post("/upload-photo")
async def upload_photo(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
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
async def get_dashboard_stats(user: dict = Depends(get_current_user)):
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
async def export_audit_pdf(run_id: str, user: dict = Depends(get_current_user)):
    """Generate PDF report for a completed audit"""
    run_audit = await db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run_audit:
        raise HTTPException(status_code=404, detail="Run audit not found")
    if run_audit["auditor_id"] != user["id"] and user["role"] not in [UserRole.ADMIN, UserRole.AUDIT_CREATOR]:
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
async def bulk_import_users(file: UploadFile = File(...), user: dict = Depends(require_role([UserRole.ADMIN]))):
    """Import users from CSV file. Expected columns: email, name, role, company_id (optional)"""
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
            if role not in ['admin', 'audit_creator', 'user']:
                role = 'user'
            
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
                "created_at": get_uk_time_iso()
            }
            await db.users.insert_one(user_doc)
            results["success"] += 1
            
        except Exception as e:
            results["errors"].append(f"Row {row_num}: {str(e)}")
            results["failed"] += 1
    
    return results

@api_router.get("/users/export-template")
async def get_user_import_template(user: dict = Depends(require_role([UserRole.ADMIN]))):
    """Download CSV template for bulk user import"""
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
    user: dict = Depends(require_role([UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
):
    # Validate audit exists
    audit = await db.audits.find_one({"id": schedule_data.audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
    
    # Validate assigned user exists
    assigned_user = await db.users.find_one({"id": schedule_data.assigned_to}, {"_id": 0, "password": 0})
    if not assigned_user:
        raise HTTPException(status_code=404, detail="Assigned user not found")
    
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
    user: dict = Depends(get_current_user)
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
async def get_my_scheduled_audits(user: dict = Depends(get_current_user)):
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
    user: dict = Depends(get_current_user)
):
    """Mark a scheduled audit as completed with the run audit ID"""
    schedule = await db.scheduled_audits.find_one({"id": schedule_id}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail="Scheduled audit not found")
    
    if schedule["assigned_to"] != user["id"] and user["role"] not in [UserRole.ADMIN, UserRole.AUDIT_CREATOR]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    await db.scheduled_audits.update_one(
        {"id": schedule_id},
        {"$set": {"status": "completed", "completed_run_id": run_id}}
    )
    
    return {"message": "Scheduled audit marked as completed"}

@api_router.delete("/scheduled-audits/{schedule_id}")
async def delete_scheduled_audit(
    schedule_id: str,
    user: dict = Depends(require_role([UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
):
    result = await db.scheduled_audits.delete_one({"id": schedule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Scheduled audit not found")
    return {"message": "Scheduled audit deleted"}

# ==================== COMPANY DASHBOARD ====================

@api_router.get("/companies/{company_id}/dashboard")
async def get_company_dashboard(company_id: str, user: dict = Depends(get_current_user)):
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
    return {"message": "Infinit-Audit API", "version": "1.1.0"}

@api_router.get("/health")
async def health():
    return {"status": "healthy"}

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
    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.audits.create_index("id", unique=True)
    await db.response_groups.create_index("id", unique=True)
    await db.audit_types.create_index("id", unique=True)
    await db.run_audits.create_index("id", unique=True)
    await db.scheduled_audits.create_index("id", unique=True)
    await db.companies.create_index("id", unique=True)
    
    # Create default admin if not exists
    admin = await db.users.find_one({"email": "admin@infinit-audit.co.uk"})
    if not admin:
        admin_doc = {
            "id": str(uuid.uuid4()),
            "email": "admin@infinit-audit.co.uk",
            "password": hash_password("admin123"),
            "name": "System Admin",
            "role": UserRole.ADMIN,
            "company_id": None,
            "created_at": get_uk_time_iso()
        }
        await db.users.insert_one(admin_doc)
        logger.info("Default admin created: admin@infinit-audit.co.uk / admin123")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
