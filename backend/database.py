from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker
from sqlalchemy.pool import StaticPool

load_dotenv()
Path("data").mkdir(exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/store_poi.db")
engine_options = {"connect_args": {"check_same_thread": False}} if DATABASE_URL.startswith("sqlite") else {}
if DATABASE_URL in {"sqlite://", "sqlite:///:memory:"}:
    engine_options["poolclass"] = StaticPool
engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Store(Base, TimestampMixin):
    __tablename__ = "stores"
    id: Mapped[int] = mapped_column(primary_key=True)
    input_name: Mapped[str] = mapped_column(String(200), index=True)
    standard_name: Mapped[str | None] = mapped_column(String(200))
    user_code: Mapped[str | None] = mapped_column(String(80))
    amap_poi_id: Mapped[str | None] = mapped_column(String(80), index=True)
    longitude: Mapped[float | None] = mapped_column(Float)
    latitude: Mapped[float | None] = mapped_column(Float)
    province: Mapped[str | None] = mapped_column(String(80))
    city: Mapped[str | None] = mapped_column(String(80), index=True)
    district: Mapped[str | None] = mapped_column(String(80))
    adcode: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(300))
    raw_address: Mapped[str | None] = mapped_column(String(500))
    standardized_address: Mapped[str | None] = mapped_column(String(500))
    geocode_level: Mapped[str | None] = mapped_column(String(40))
    location_source: Mapped[str | None] = mapped_column(String(40))
    poi_type: Mapped[str | None] = mapped_column(String(200))
    poi_typecode: Mapped[str | None] = mapped_column(String(30))
    match_score: Mapped[int | None] = mapped_column(Integer)
    match_status: Mapped[str] = mapped_column(String(30), default="待确认")
    confirmation_method: Mapped[str | None] = mapped_column(String(40))
    confirmed_by: Mapped[str | None] = mapped_column(String(80))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    source: Mapped[str] = mapped_column(String(30), default="mock")
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime)


class StoreMatchCandidate(Base, TimestampMixin):
    __tablename__ = "store_match_candidates"
    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), index=True)
    amap_poi_id: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(300))
    longitude: Mapped[float] = mapped_column(Float)
    latitude: Mapped[float] = mapped_column(Float)
    score: Mapped[int] = mapped_column(Integer)
    reasons: Mapped[list] = mapped_column(JSON, default=list)


class PoiCategory(Base, TimestampMixin):
    __tablename__ = "poi_categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("poi_categories.id"))
    display_name: Mapped[str] = mapped_column(String(80))
    search_mode: Mapped[str] = mapped_column(String(30))
    typecodes: Mapped[str | None] = mapped_column(String(500))
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    color: Mapped[str] = mapped_column(String(20), default="#08745b")
    icon: Mapped[str | None] = mapped_column(String(80))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(Text)
    source_version: Mapped[str] = mapped_column(String(40), default="AMAP-2026-07")


class AnalysisJob(Base, TimestampMixin):
    __tablename__ = "analysis_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(30), default="等待处理", index=True)
    total_stores: Mapped[int] = mapped_column(Integer, default=0)
    processed_stores: Mapped[int] = mapped_column(Integer, default=0)
    matched_stores: Mapped[int] = mapped_column(Integer, default=0)
    pending_stores: Mapped[int] = mapped_column(Integer, default=0)
    success_stores: Mapped[int] = mapped_column(Integer, default=0)
    failed_stores: Mapped[int] = mapped_column(Integer, default=0)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    truncated: Mapped[bool] = mapped_column(Boolean, default=False)


class AnalysisJobStore(Base, TimestampMixin):
    __tablename__ = "analysis_job_stores"
    __table_args__ = (UniqueConstraint("analysis_job_id", "store_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    analysis_job_id: Mapped[int] = mapped_column(ForeignKey("analysis_jobs.id", ondelete="CASCADE"), index=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30))
    error_code: Mapped[str | None] = mapped_column(String(60))
    error_message: Mapped[str | None] = mapped_column(Text)


class PoiResult(Base, TimestampMixin):
    __tablename__ = "poi_results"
    __table_args__ = (UniqueConstraint("analysis_job_id", "store_id", "amap_poi_id", "poi_category"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    analysis_job_id: Mapped[int] = mapped_column(ForeignKey("analysis_jobs.id", ondelete="CASCADE"), index=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), index=True)
    amap_poi_id: Mapped[str] = mapped_column(String(100), index=True)
    parent_poi_id: Mapped[str | None] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(200))
    poi_category: Mapped[str] = mapped_column(String(80), index=True)
    poi_type: Mapped[str | None] = mapped_column(String(200))
    poi_typecode: Mapped[str | None] = mapped_column(String(30))
    longitude: Mapped[float] = mapped_column(Float)
    latitude: Mapped[float] = mapped_column(Float)
    straight_distance_m: Mapped[int] = mapped_column(Integer)
    walking_distance_m: Mapped[int | None] = mapped_column(Integer)
    walking_duration_s: Mapped[int | None] = mapped_column(Integer)
    province: Mapped[str | None] = mapped_column(String(80))
    city: Mapped[str | None] = mapped_column(String(80))
    district: Mapped[str | None] = mapped_column(String(80))
    adcode: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(300))
    business_area: Mapped[str | None] = mapped_column(String(120), index=True)
    distance_bucket: Mapped[str] = mapped_column(String(40))
    search_keyword: Mapped[str | None] = mapped_column(String(100))
    search_typecodes: Mapped[str | None] = mapped_column(String(500))
    search_radius: Mapped[int] = mapped_column(Integer)
    manually_corrected: Mapped[bool] = mapped_column(Boolean, default=False)
    excluded: Mapped[bool] = mapped_column(Boolean, default=False)


class SearchRequestLog(Base, TimestampMixin):
    __tablename__ = "search_request_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[str] = mapped_column(String(40), index=True)
    endpoint: Mapped[str] = mapped_column(String(100))
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30))
    error_code: Mapped[str | None] = mapped_column(String(60))
    truncated: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditLog(Base, TimestampMixin):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[int] = mapped_column(Integer)
    actor: Mapped[str] = mapped_column(String(80), default="本地用户")
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class BusinessDistrictAnalysis(Base, TimestampMixin):
    __tablename__ = "business_district_analyses"
    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), index=True)
    analysis_job_id: Mapped[int | None] = mapped_column(ForeignKey("analysis_jobs.id", ondelete="SET NULL"), index=True)
    analysis_version: Mapped[str] = mapped_column(String(60), index=True)
    poi_config_version: Mapped[str] = mapped_column(String(60))
    weight_version: Mapped[str] = mapped_column(String(60))
    amap_query_time: Mapped[str | None] = mapped_column(String(50))
    radius_config: Mapped[list] = mapped_column(JSON, default=list)
    location_source: Mapped[str | None] = mapped_column(String(40))
    business_area_name: Mapped[str | None] = mapped_column(String(120), index=True)
    business_area_source: Mapped[str | None] = mapped_column(String(80))
    business_area_confidence: Mapped[str | None] = mapped_column(String(20))
    business_district_type: Mapped[str] = mapped_column(String(50), index=True)
    type_scores: Mapped[dict] = mapped_column(JSON, default=dict)
    type_confidence: Mapped[str] = mapped_column(String(20))
    level: Mapped[str] = mapped_column(String(10), index=True)
    level_score: Mapped[float] = mapped_column(Float)
    level_mode: Mapped[str] = mapped_column(String(50))
    fit_score: Mapped[float] = mapped_column(Float, index=True)
    fit_level: Mapped[str] = mapped_column(String(30))
    competition_score: Mapped[float] = mapped_column(Float)
    competition_level: Mapped[str] = mapped_column(String(30), index=True)
    confidence_level: Mapped[str] = mapped_column(String(20), index=True)
    feature_vector: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    strengths: Mapped[list] = mapped_column(JSON, default=list)
    weaknesses: Mapped[list] = mapped_column(JSON, default=list)
    truncation_flags: Mapped[dict] = mapped_column(JSON, default=dict)
    warning_messages: Mapped[list] = mapped_column(JSON, default=list)


class BusinessDistrictConfig(Base, TimestampMixin):
    __tablename__ = "business_district_configs"
    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(String(60), unique=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


def init_db() -> None:
    Base.metadata.create_all(engine)
    from .migrate import run_migrations
    run_migrations()
