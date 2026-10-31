"""SQLAlchemy models. Importing this package registers every table on `Base.metadata`."""

from app.db import Base
from app.models.identity import Membership, OAuthToken, Organisation, PasswordResetToken, User
from app.models.ops import Export, IndesignBridge, Job
from app.models.project import (
    Activity,
    Approval,
    Article,
    Asset,
    EventSession,
    ExtractedFact,
    MagazinePage,
    Project,
    Speaker,
    TranscriptSegment,
    VideoSource,
)
from app.models.reference import DesignProfile, ReferenceMagazine, ReferencePage, Template

__all__ = [
    "Base",
    "User",
    "Organisation",
    "Membership",
    "PasswordResetToken",
    "OAuthToken",
    "Project",
    "VideoSource",
    "TranscriptSegment",
    "Speaker",
    "EventSession",
    "ExtractedFact",
    "Article",
    "Asset",
    "MagazinePage",
    "Approval",
    "Activity",
    "ReferenceMagazine",
    "ReferencePage",
    "DesignProfile",
    "Template",
    "Export",
    "Job",
    "IndesignBridge",
]
