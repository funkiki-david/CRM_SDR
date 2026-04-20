"""
Contacts API — CRUD operations for contacts
Includes ownership-based access control and dedup checking.
"""

import csv
import io
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.contact import Contact
from app.models.activity import Activity, ActivityType
from app.schemas.contact import (
    ContactCreate, ContactUpdate, ContactResponse, ContactListResponse,
    DedupCheckResponse,
)

router = APIRouter(prefix="/api/contacts", tags=["Contacts"])


# === CSV Import/Export ===
# 导出字段顺序也作为模板下载顺序，跟 ContactCreate 对齐
CSV_EXPORT_COLUMNS = [
    "first_name", "last_name", "email", "mobile_phone", "office_phone", "title",
    "company_name", "company_domain", "industry", "company_size",
    "city", "state", "linkedin_url", "website",
    "industry_tags", "notes",
]

# 常见字段别名 → 标准字段名（大小写不敏感）
# 客户的 CSV 表头可能千奇百怪，这里做宽松映射
CSV_ALIAS_MAP = {
    "firstname": "first_name", "first name": "first_name", "fname": "first_name",
    "lastname": "last_name", "last name": "last_name", "lname": "last_name", "surname": "last_name",
    "email address": "email", "e-mail": "email", "mail": "email",
    # Phone: 两个字段 mobile / office。Legacy "phone" 列默认映射到 office_phone
    "phone": "office_phone", "phone number": "office_phone",
    "tel": "office_phone", "telephone": "office_phone",
    "office": "office_phone", "office phone": "office_phone", "work phone": "office_phone",
    "mobile": "mobile_phone", "mobile phone": "mobile_phone",
    "cell": "mobile_phone", "cell phone": "mobile_phone", "cellphone": "mobile_phone",
    "job title": "title", "position": "title", "role": "title",
    "company": "company_name", "organization": "company_name", "org": "company_name",
    "domain": "company_domain", "website domain": "company_domain",
    "linkedin": "linkedin_url", "linkedin profile": "linkedin_url",
    "web": "website", "company website": "website", "url": "website",
    "tags": "industry_tags", "keywords": "industry_tags",
    "note": "notes", "comment": "notes", "comments": "notes",
}


def _normalize_header(h: str) -> str:
    """规范化表头 —— 小写、去首尾空格、别名映射"""
    key = (h or "").strip().lower()
    return CSV_ALIAS_MAP.get(key, key.replace(" ", "_"))


def _parse_tags(raw: str) -> list[str]:
    """逗号或分号分隔的 tag 字符串 → list"""
    if not raw:
        return []
    parts = [t.strip() for t in raw.replace(";", ",").split(",")]
    return [t for t in parts if t][:10]


def _apply_ownership_filter(query, user: User):
    """
    Team-shared data model: every logged-in user (Admin / Manager / SDR)
    sees all contacts. assigned_to marks "who works the contact" but does
    not gate read access.

    Kept as a no-op function so we can reintroduce per-role filtering later
    without touching all call sites.
    """
    _ = user  # reserved for future filtering
    return query


@router.get("", response_model=ContactListResponse)
async def list_contacts(
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List contacts with search and pagination"""
    query = select(Contact)
    query = _apply_ownership_filter(query, current_user)

    if search:
        search_term = f"%{search}%"
        query = query.where(
            or_(
                Contact.first_name.ilike(search_term),
                Contact.last_name.ilike(search_term),
                Contact.email.ilike(search_term),
                Contact.company_name.ilike(search_term),
                Contact.title.ilike(search_term),
            )
        )

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    query = query.order_by(Contact.updated_at.desc()).offset(skip).limit(limit)
    result = await db.execute(query)
    contacts = result.scalars().all()

    return ContactListResponse(contacts=contacts, total=total)


@router.get("/check-email")
async def check_email_dedup(
    email: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Check if an email already exists in the database.
    Used by the Add Contact modal for dedup detection.
    """
    result = await db.execute(
        select(Contact).where(Contact.email == email.lower().strip())
    )
    existing = result.scalar_one_or_none()

    if existing is None:
        return {"exists": False, "existing_contact": None, "last_activity_date": None}

    # Get last activity date
    act_result = await db.execute(
        select(Activity.created_at)
        .where(Activity.contact_id == existing.id)
        .order_by(Activity.created_at.desc())
        .limit(1)
    )
    last_act = act_result.scalar_one_or_none()

    return {
        "exists": True,
        "existing_contact": ContactResponse.model_validate(existing),
        "last_activity_date": str(last_act) if last_act else None,
    }


# === CSV Export ===
# 注意：必须在 /{contact_id} 之前注册，否则 FastAPI 会把 "export" 当成 contact_id

@router.get("/export")
async def export_contacts(
    format: str = Query("csv"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    导出联系人为 CSV (UTF-8 BOM, Excel 中文不乱码)
    遵守角色权限：SDR 只导出自己的，Admin/Manager 导出全部
    """
    if format != "csv":
        raise HTTPException(status_code=400, detail="Only csv format is supported")

    query = select(Contact).order_by(Contact.id)
    query = _apply_ownership_filter(query, current_user)
    result = await db.execute(query)
    contacts = result.scalars().all()

    buffer = io.StringIO()
    # BOM for Excel UTF-8 recognition
    buffer.write("\ufeff")
    writer = csv.writer(buffer)
    writer.writerow(CSV_EXPORT_COLUMNS)

    for c in contacts:
        tags = c.industry_tags_array or []
        tag_str = ",".join(tags) if tags else ""
        writer.writerow([
            c.first_name or "",
            c.last_name or "",
            c.email or "",
            c.mobile_phone or "",
            c.office_phone or "",
            c.title or "",
            c.company_name or "",
            c.company_domain or "",
            c.industry or "",
            c.company_size or "",
            c.city or "",
            c.state or "",
            c.linkedin_url or "",
            c.website or "",
            tag_str,
            (c.notes or "").replace("\r\n", " ").replace("\n", " "),
        ])

    buffer.seek(0)
    filename = f"contacts_export_{len(contacts)}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/template")
async def download_template(
    current_user: User = Depends(get_current_user),
):
    """下载空白 CSV 模板（只含表头 + 一行示例）"""
    buffer = io.StringIO()
    buffer.write("\ufeff")
    writer = csv.writer(buffer)
    writer.writerow(CSV_EXPORT_COLUMNS)
    # 示例行 example row to make field format clear
    writer.writerow([
        "Jane", "Doe", "jane@example.com", "555-123-4567", "VP Sales",
        "Acme Corp", "acme.com", "Software", "50-200",
        "San Francisco", "CA", "https://linkedin.com/in/janedoe", "https://acme.com",
        "SaaS,Decision Maker", "Met at SaaStr 2025",
    ])
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="contacts_template.csv"'},
    )


# === CSV Import ===

@router.post("/import")
async def import_contacts(
    file: UploadFile = File(...),
    update_existing: bool = Query(False, description="如果邮箱已存在，是否更新（否则跳过）"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    批量导入联系人 CSV。
    Dedup 规则：按 email 精确匹配（已存在 → 根据 update_existing 决定跳过/更新）。
    返回：成功/跳过/失败统计 + 错误详情。
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="File is empty")

    # 尝试 utf-8（带 BOM），失败 fallback gbk（Excel 中文导出默认）
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("gbk")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="文件编码不支持（需 UTF-8 或 GBK）")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV missing header row")

    # 标准化表头
    normalized_fields = {h: _normalize_header(h) for h in reader.fieldnames}

    batch_id = str(uuid.uuid4())
    created = updated = skipped = 0
    failed: list[dict] = []

    for row_num, raw_row in enumerate(reader, start=2):  # start=2 因为 1 是表头
        row = {normalized_fields[k]: (v or "").strip() for k, v in raw_row.items()}

        # Email 可选 —— 手机单联系人（Doug 的 CA 名单）没有 email 也能进
        # Email is optional; phone-only leads are allowed (dedup by email if present)
        if not row.get("first_name"):
            failed.append({"row": row_num, "reason": "missing first_name"})
            continue

        payload = {
            "first_name": row.get("first_name") or "",
            "last_name": row.get("last_name") or "",
        }
        if row.get("email"):
            payload["email"] = row.get("email")
        for key in ("mobile_phone", "office_phone",
                    "title", "company_name", "company_domain",
                    "industry", "company_size", "city", "state",
                    "linkedin_url", "website", "notes"):
            v = row.get(key)
            if v:
                payload[key] = v

        tags = _parse_tags(row.get("industry_tags", ""))
        if tags:
            payload["industry_tags"] = tags

        try:
            validated = ContactCreate(**payload)
        except ValidationError as e:
            failed.append({
                "row": row_num,
                "email": row.get("email"),
                "reason": "; ".join(err["msg"] for err in e.errors())[:200],
            })
            continue

        # Dedup strategy:
        #   1) email present → match by email (primary key for known contacts)
        #   2) email absent  → match by (first_name, last_name, company_name, office_phone)
        #      so repeated sync of email-less rows (e.g. Doug's CA list) doesn't
        #      duplicate. Uses office_phone only (mobile is optional).
        existing = None
        if validated.email:
            existing_q = await db.execute(
                select(Contact).where(Contact.email == validated.email)
            )
            existing = existing_q.scalar_one_or_none()
        else:
            fn = (validated.first_name or "").strip().lower()
            ln = (validated.last_name or "").strip().lower()
            co = (row.get("company_name") or "").strip().lower()
            ph = (validated.office_phone or validated.phone or "").strip()
            if fn and (co or ph):
                existing_q = await db.execute(
                    select(Contact).where(
                        Contact.email.is_(None) | (Contact.email == ""),
                        func.lower(Contact.first_name) == fn,
                        func.lower(func.coalesce(Contact.last_name, "")) == ln,
                        func.lower(func.coalesce(Contact.company_name, "")) == co,
                        func.coalesce(Contact.office_phone, "") == ph,
                    )
                )
                existing = existing_q.scalar_one_or_none()

        if existing:
            if update_existing:
                contact_data = validated.model_dump(exclude={"industry_tags", "phone"})
                if validated.phone and not contact_data.get("office_phone"):
                    contact_data["office_phone"] = validated.phone
                for k, v in contact_data.items():
                    if v is not None:
                        setattr(existing, k, v)
                if validated.industry_tags:
                    existing.industry_tags_array = validated.industry_tags
                    import json as _json
                    existing.ai_tags = _json.dumps(validated.industry_tags)
                updated += 1
            else:
                skipped += 1
            continue

        contact_data = validated.model_dump(exclude={"industry_tags", "phone"})
        if validated.phone and not contact_data.get("office_phone"):
            contact_data["office_phone"] = validated.phone
        contact = Contact(
            **contact_data,
            owner_id=current_user.id,
            import_source="csv_import",
            import_batch_id=batch_id,
        )
        if validated.industry_tags:
            contact.industry_tags_array = validated.industry_tags
            import json as _json
            contact.ai_tags = _json.dumps(validated.industry_tags)

        db.add(contact)
        await db.flush()
        created += 1

    await db.flush()

    return {
        "batch_id": batch_id,
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "failed": len(failed),
        "errors": failed[:50],
    }


@router.get("/{contact_id}", response_model=ContactResponse)
async def get_contact(
    contact_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single contact by ID"""
    query = select(Contact).where(Contact.id == contact_id)
    query = _apply_ownership_filter(query, current_user)

    result = await db.execute(query)
    contact = result.scalar_one_or_none()

    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@router.post("", response_model=ContactResponse, status_code=status.HTTP_201_CREATED)
async def create_contact(
    data: ContactCreate,
    force_create: bool = Query(False, description="Create even if email exists (duplicate)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new contact.
    If email already exists and force_create=False, returns 409 with existing contact info.
    """
    # Dedup check (unless force_create)
    if not force_create and data.email:
        result = await db.execute(
            select(Contact).where(Contact.email == data.email.lower().strip())
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Email already exists",
                    "existing_contact_id": existing.id,
                    "existing_name": f"{existing.first_name} {existing.last_name}",
                    "existing_title": existing.title,
                    "existing_company": existing.company_name,
                },
            )

    # Build contact from data
    # Legacy "phone" input → office_phone (only if office_phone is empty)
    contact_data = data.model_dump(exclude={"industry_tags", "phone"})
    if data.phone and not contact_data.get("office_phone"):
        contact_data["office_phone"] = data.phone
    contact = Contact(
        **contact_data,
        owner_id=current_user.id,
        import_source="manual",
    )

    # Handle industry tags
    if data.industry_tags:
        contact.industry_tags_array = data.industry_tags
        # Also store as JSON string in ai_tags for backward compat
        import json
        contact.ai_tags = json.dumps(data.industry_tags)

    db.add(contact)
    await db.flush()

    # Log an activity for the creation
    activity = Activity(
        activity_type=ActivityType.NOTE,
        subject=f"Contact added manually",
        content=f"Added {data.first_name} {data.last_name} ({data.email})",
        contact_id=contact.id,
        user_id=current_user.id,
    )
    db.add(activity)
    await db.flush()

    return contact


@router.put("/{contact_id}", response_model=ContactResponse)
async def update_contact_full(
    contact_id: int,
    data: ContactCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update an existing contact with new data (used by dedup "Update existing" flow).
    Replaces all fields with the new data.
    """
    query = select(Contact).where(Contact.id == contact_id)
    query = _apply_ownership_filter(query, current_user)

    result = await db.execute(query)
    contact = result.scalar_one_or_none()

    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    update_data = data.model_dump(exclude={"industry_tags", "phone"})
    if data.phone and not update_data.get("office_phone"):
        update_data["office_phone"] = data.phone
    for field, value in update_data.items():
        if value is not None:
            setattr(contact, field, value)

    if data.industry_tags:
        contact.industry_tags_array = data.industry_tags
        import json
        contact.ai_tags = json.dumps(data.industry_tags)

    await db.flush()
    return contact


@router.patch("/{contact_id}", response_model=ContactResponse)
async def update_contact(
    contact_id: int,
    data: ContactUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a contact's info (partial update)"""
    query = select(Contact).where(Contact.id == contact_id)
    query = _apply_ownership_filter(query, current_user)

    result = await db.execute(query)
    contact = result.scalar_one_or_none()

    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    update_data = data.model_dump(exclude_unset=True)

    # Handle industry_tags separately
    tags = update_data.pop("industry_tags", None)
    if tags is not None:
        contact.industry_tags_array = tags
        import json
        contact.ai_tags = json.dumps(tags)

    # Legacy "phone" shim → office_phone (only if office_phone not also being set)
    legacy_phone = update_data.pop("phone", None)
    if legacy_phone and "office_phone" not in update_data:
        update_data["office_phone"] = legacy_phone

    for field, value in update_data.items():
        setattr(contact, field, value)

    await db.flush()
    return contact


# === Delete (Admin only) ===

@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    contact_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Permanently delete a contact and all its dependent records
    (activities / leads / sent_emails cascade). Admin only.

    用于清理测试数据 / 误录入的联系人。对应前端"Delete"按钮。
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only Admin can delete contacts")

    contact = await db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    # 级联清理依赖表（contacts 表的外键是 RESTRICT 不是 CASCADE，必须手动删）
    from app.models.activity import Activity
    from app.models.lead import Lead
    from app.models.sent_email import SentEmail

    await db.execute(SentEmail.__table__.delete().where(SentEmail.contact_id == contact_id))
    await db.execute(Activity.__table__.delete().where(Activity.contact_id == contact_id))
    await db.execute(Lead.__table__.delete().where(Lead.contact_id == contact_id))
    await db.delete(contact)
    await db.flush()
    return None


