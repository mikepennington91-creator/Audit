from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
import base64

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

# ==================== MODELS ====================

# User Models
class UserRole:
    ADMIN = "admin"
    AUDIT_CREATOR = "audit_creator"
    USER = "user"

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = UserRole.USER

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: str
    name: str
    role: str
    created_at: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None

# Response Group Models
class ResponseOption(BaseModel):
    label: str
    value: str
    score: Optional[float] = None

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
    created_at: str

# Question Models
class QuestionCreate(BaseModel):
    text: str
    response_group_id: Optional[str] = None
    custom_responses: Optional[List[ResponseOption]] = None
    enable_scoring: bool = False
    required: bool = True
    order: int = 0

class QuestionResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    text: str
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

class RunAuditCreate(BaseModel):
    audit_id: str
    location: Optional[str] = None

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
        if user["role"] not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return role_checker

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
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    token = create_token(user_id, user_data.email, user_data.role)
    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": user_data.email,
            "name": user_data.name,
            "role": user_data.role
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
            "role": user["role"]
        }
    }

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(user: dict = Depends(get_current_user)):
    return UserResponse(**user)

# ==================== USER MANAGEMENT (ADMIN) ====================

@api_router.get("/users", response_model=List[UserResponse])
async def get_users(user: dict = Depends(require_role([UserRole.ADMIN]))):
    users = await db.users.find({}, {"_id": 0, "password": 0}).to_list(1000)
    return [UserResponse(**u) for u in users]

@api_router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: str, update_data: UserUpdate, user: dict = Depends(require_role([UserRole.ADMIN]))):
    update_dict = {k: v for k, v in update_data.model_dump().items() if v is not None}
    if "password" in update_dict:
        update_dict["password"] = hash_password(update_dict["password"])
    
    if not update_dict:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await db.users.update_one({"id": user_id}, {"$set": update_dict})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    updated_user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    return UserResponse(**updated_user)

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_role([UserRole.ADMIN]))):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted successfully"}

# ==================== RESPONSE GROUPS ====================

@api_router.post("/response-groups", response_model=ResponseGroupResponse)
async def create_response_group(
    group_data: ResponseGroupCreate,
    user: dict = Depends(require_role([UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
):
    group_id = str(uuid.uuid4())
    group_doc = {
        "id": group_id,
        "name": group_data.name,
        "options": [opt.model_dump() for opt in group_data.options],
        "enable_scoring": group_data.enable_scoring,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.response_groups.insert_one(group_doc)
    return ResponseGroupResponse(**group_doc)

@api_router.get("/response-groups", response_model=List[ResponseGroupResponse])
async def get_response_groups(user: dict = Depends(get_current_user)):
    groups = await db.response_groups.find({}, {"_id": 0}).to_list(1000)
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
    user: dict = Depends(require_role([UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
):
    result = await db.response_groups.delete_one({"id": group_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Response group not found")
    return {"message": "Response group deleted successfully"}

# ==================== AUDIT TYPES ====================

@api_router.post("/audit-types", response_model=AuditTypeResponse)
async def create_audit_type(
    type_data: AuditTypeCreate,
    user: dict = Depends(require_role([UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
):
    type_id = str(uuid.uuid4())
    type_doc = {
        "id": type_id,
        "name": type_data.name,
        "description": type_data.description,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.audit_types.insert_one(type_doc)
    return AuditTypeResponse(**type_doc)

@api_router.get("/audit-types", response_model=List[AuditTypeResponse])
async def get_audit_types(user: dict = Depends(get_current_user)):
    types = await db.audit_types.find({}, {"_id": 0}).to_list(1000)
    return [AuditTypeResponse(**t) for t in types]

@api_router.delete("/audit-types/{type_id}")
async def delete_audit_type(
    type_id: str,
    user: dict = Depends(require_role([UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
):
    result = await db.audit_types.delete_one({"id": type_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Audit type not found")
    return {"message": "Audit type deleted successfully"}

# ==================== AUDITS ====================

@api_router.post("/audits", response_model=AuditResponse)
async def create_audit(
    audit_data: AuditCreate,
    user: dict = Depends(require_role([UserRole.ADMIN, UserRole.AUDIT_CREATOR]))
):
    audit_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    
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
        "created_at": now,
        "updated_at": now
    }
    await db.audits.insert_one(audit_doc)
    return AuditResponse(**audit_doc)

@api_router.get("/audits", response_model=List[AuditResponse])
async def get_audits(user: dict = Depends(get_current_user)):
    query = {}
    # Non-admin users can only see public audits or their own
    if user["role"] == UserRole.USER:
        query = {"$or": [{"is_private": False}, {"created_by": user["id"]}]}
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
    
    update_dict["updated_at"] = datetime.now(timezone.utc).isoformat()
    
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
        "location": run_data.location,
        "answers": [],
        "notes": None,
        "completed": False,
        "total_score": None,
        "pass_status": None,
        "started_at": datetime.now(timezone.utc).isoformat(),
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
    
    # Calculate score if scoring enabled
    total_score = None
    pass_status = None
    answers = [a.model_dump() for a in submit_data.answers]
    
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
        update_dict["completed_at"] = datetime.now(timezone.utc).isoformat()
    
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
        "uploaded_at": datetime.now(timezone.utc).isoformat()
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

@api_router.get("/")
async def root():
    return {"message": "Infinit-Audit API", "version": "1.0.0"}

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
    
    # Create default admin if not exists
    admin = await db.users.find_one({"email": "admin@infinit-audit.co.uk"})
    if not admin:
        admin_doc = {
            "id": str(uuid.uuid4()),
            "email": "admin@infinit-audit.co.uk",
            "password": hash_password("admin123"),
            "name": "System Admin",
            "role": UserRole.ADMIN,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.users.insert_one(admin_doc)
        logger.info("Default admin created: admin@infinit-audit.co.uk / admin123")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
