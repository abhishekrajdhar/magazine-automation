"""Initial PressFlow schema (all tables).

Revision ID: 0001_initial
Revises: 
Create Date: 2026-10-31 19:22:08.666490
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# Portable JSON: JSONB on PostgreSQL, JSON elsewhere (matches app.db.JSONType).
JSONType = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

revision: str = '0001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('activity',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=False),
    sa.Column('project_id', sa.String(length=64), nullable=True),
    sa.Column('actor_id', sa.String(length=64), nullable=False),
    sa.Column('verb', sa.String(length=200), nullable=False),
    sa.Column('target', sa.String(length=400), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('is_demo', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('activity', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_activity_org_id'), ['org_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_activity_project_id'), ['project_id'], unique=False)

    op.create_table('approvals',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=False),
    sa.Column('project_id', sa.String(length=64), nullable=True),
    sa.Column('target_kind', sa.String(length=20), nullable=False),
    sa.Column('target_id', sa.String(length=64), nullable=False),
    sa.Column('action', sa.String(length=20), nullable=False),
    sa.Column('actor_id', sa.String(length=64), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('version', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('approvals', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_approvals_org_id'), ['org_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_approvals_project_id'), ['project_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_approvals_target_id'), ['target_id'], unique=False)

    op.create_table('exports',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=False),
    sa.Column('project_id', sa.String(length=64), nullable=False),
    sa.Column('format', sa.String(length=30), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('renderer', sa.String(length=20), nullable=False),
    sa.Column('file_name', sa.String(length=400), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=True),
    sa.Column('content_type', sa.String(length=120), nullable=True),
    sa.Column('storage_key', sa.String(length=600), nullable=True),
    sa.Column('extra_files', JSONType, nullable=True),
    sa.Column('contract', JSONType, nullable=True),
    sa.Column('options', JSONType, nullable=True),
    sa.Column('report', JSONType, nullable=True),
    sa.Column('message', sa.Text(), nullable=True),
    sa.Column('job_id', sa.String(length=64), nullable=True),
    sa.Column('created_by', sa.String(length=64), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('exports', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_exports_org_id'), ['org_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_exports_project_id'), ['project_id'], unique=False)

    op.create_table('indesign_bridges',
    sa.Column('id', sa.String(length=120), nullable=False),
    sa.Column('hostname', sa.String(length=300), nullable=False),
    sa.Column('mode', sa.String(length=20), nullable=False),
    sa.Column('indesign_version', sa.String(length=60), nullable=False),
    sa.Column('platform', sa.String(length=60), nullable=False),
    sa.Column('fonts', JSONType, nullable=False),
    sa.Column('last_heartbeat_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('jobs_completed', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('jobs',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=True),
    sa.Column('kind', sa.String(length=40), nullable=False),
    sa.Column('queue', sa.String(length=20), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('progress', sa.Float(), nullable=False),
    sa.Column('message', sa.Text(), nullable=True),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('max_attempts', sa.Integer(), nullable=False),
    sa.Column('payload', JSONType, nullable=False),
    sa.Column('result_ref', sa.String(length=64), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('run_after', sa.DateTime(timezone=True), nullable=True),
    sa.Column('lease_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('locked_by', sa.String(length=120), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('jobs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_jobs_kind'), ['kind'], unique=False)
        batch_op.create_index(batch_op.f('ix_jobs_org_id'), ['org_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_jobs_queue'), ['queue'], unique=False)
        batch_op.create_index(batch_op.f('ix_jobs_status'), ['status'], unique=False)

    op.create_table('organisations',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('slug', sa.String(length=120), nullable=False),
    sa.Column('plan', sa.String(length=20), nullable=False),
    sa.Column('is_demo', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('organisations', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_organisations_slug'), ['slug'], unique=True)

    op.create_table('templates',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=False),
    sa.Column('reference_id', sa.String(length=64), nullable=True),
    sa.Column('name', sa.String(length=300), nullable=False),
    sa.Column('page_type', sa.String(length=40), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('reference_page_number', sa.Integer(), nullable=True),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('slots', JSONType, nullable=False),
    sa.Column('columns', sa.Integer(), nullable=False),
    sa.Column('is_demo', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('templates', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_templates_org_id'), ['org_id'], unique=False)

    op.create_table('users',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=True),
    sa.Column('password_hash', sa.String(length=200), nullable=True),
    sa.Column('token_version', sa.Integer(), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_demo', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)

    op.create_table('memberships',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.String(length=64), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('invited_by', sa.String(length=64), nullable=True),
    sa.Column('last_active_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organisations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'user_id', name='uq_membership_org_user')
    )
    with op.batch_alter_table('memberships', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_memberships_org_id'), ['org_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_memberships_user_id'), ['user_id'], unique=False)

    op.create_table('oauth_tokens',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.String(length=64), nullable=False),
    sa.Column('provider', sa.String(length=40), nullable=False),
    sa.Column('account_email', sa.String(length=320), nullable=True),
    sa.Column('scopes', sa.Text(), nullable=False),
    sa.Column('access_token_enc', sa.Text(), nullable=False),
    sa.Column('refresh_token_enc', sa.Text(), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organisations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'user_id', 'provider', name='uq_oauth_org_user_provider')
    )
    with op.batch_alter_table('oauth_tokens', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_oauth_tokens_org_id'), ['org_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_oauth_tokens_user_id'), ['user_id'], unique=False)

    op.create_table('password_reset_tokens',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.String(length=64), nullable=False),
    sa.Column('token_hash', sa.String(length=128), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('password_reset_tokens', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_password_reset_tokens_token_hash'), ['token_hash'], unique=True)
        batch_op.create_index(batch_op.f('ix_password_reset_tokens_user_id'), ['user_id'], unique=False)

    op.create_table('projects',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('event_name', sa.String(length=300), nullable=False),
    sa.Column('category', sa.String(length=120), nullable=False),
    sa.Column('issue_number', sa.String(length=120), nullable=False),
    sa.Column('publication_date', sa.String(length=40), nullable=False),
    sa.Column('publisher', sa.String(length=200), nullable=False),
    sa.Column('target_page_count', sa.Integer(), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('reference_id', sa.String(length=64), nullable=True),
    sa.Column('design_profile_id', sa.String(length=64), nullable=True),
    sa.Column('config', JSONType, nullable=False),
    sa.Column('owner_id', sa.String(length=64), nullable=False),
    sa.Column('is_demo', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organisations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_projects_org_id'), ['org_id'], unique=False)

    op.create_table('reference_magazines',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('file_name', sa.String(length=400), nullable=False),
    sa.Column('file_size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('page_count', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('analysis_progress', sa.Float(), nullable=False),
    sa.Column('analysis_message', sa.Text(), nullable=True),
    sa.Column('analyser', sa.String(length=30), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('design_profile_id', sa.String(length=64), nullable=True),
    sa.Column('storage_key', sa.String(length=600), nullable=True),
    sa.Column('indd_key', sa.String(length=600), nullable=True),
    sa.Column('indd_file_name', sa.String(length=400), nullable=True),
    sa.Column('uploaded_by', sa.String(length=64), nullable=True),
    sa.Column('is_demo', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organisations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('reference_magazines', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_reference_magazines_org_id'), ['org_id'], unique=False)

    op.create_table('articles',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('project_id', sa.String(length=64), nullable=False),
    sa.Column('type', sa.String(length=40), nullable=False),
    sa.Column('kicker', sa.String(length=200), nullable=True),
    sa.Column('headline', sa.Text(), nullable=False),
    sa.Column('subheadline', sa.Text(), nullable=False),
    sa.Column('byline', sa.String(length=300), nullable=True),
    sa.Column('intro', sa.Text(), nullable=False),
    sa.Column('body', JSONType, nullable=False),
    sa.Column('quote_fact_ids', JSONType, nullable=False),
    sa.Column('speaker_ids', JSONType, nullable=False),
    sa.Column('session_ids', JSONType, nullable=False),
    sa.Column('suggested_image_ids', JSONType, nullable=False),
    sa.Column('captions', JSONType, nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('generated_by', sa.String(length=20), nullable=False),
    sa.Column('approved_by', sa.String(length=64), nullable=True),
    sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('review_note', sa.Text(), nullable=True),
    sa.Column('variants', JSONType, nullable=True),
    sa.Column('last_verification', JSONType, nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('articles', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_articles_project_id'), ['project_id'], unique=False)

    op.create_table('assets',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=False),
    sa.Column('project_id', sa.String(length=64), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('file_name', sa.String(length=400), nullable=False),
    sa.Column('content_type', sa.String(length=120), nullable=True),
    sa.Column('size_bytes', sa.BigInteger(), nullable=True),
    sa.Column('width_px', sa.Integer(), nullable=False),
    sa.Column('height_px', sa.Integer(), nullable=False),
    sa.Column('session_id', sa.String(length=64), nullable=True),
    sa.Column('video_id', sa.String(length=64), nullable=True),
    sa.Column('speaker_id', sa.String(length=64), nullable=True),
    sa.Column('tags', JSONType, nullable=False),
    sa.Column('caption', sa.Text(), nullable=True),
    sa.Column('credit', sa.String(length=300), nullable=True),
    sa.Column('seed', sa.Integer(), nullable=False),
    sa.Column('storage_key', sa.String(length=600), nullable=True),
    sa.Column('simulated', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('assets', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_assets_org_id'), ['org_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_assets_project_id'), ['project_id'], unique=False)

    op.create_table('design_profiles',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=False),
    sa.Column('reference_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=300), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('profile', JSONType, nullable=False),
    sa.Column('overrides', JSONType, nullable=False),
    sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('approved_by', sa.String(length=64), nullable=True),
    sa.Column('is_demo', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['reference_id'], ['reference_magazines.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('design_profiles', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_design_profiles_org_id'), ['org_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_design_profiles_reference_id'), ['reference_id'], unique=False)

    op.create_table('event_sessions',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('project_id', sa.String(length=64), nullable=False),
    sa.Column('video_id', sa.String(length=64), nullable=False),
    sa.Column('title', sa.String(length=400), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('speaker_ids', JSONType, nullable=False),
    sa.Column('summary', sa.Text(), nullable=False),
    sa.Column('topics', JSONType, nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('start_sec', sa.Float(), nullable=True),
    sa.Column('end_sec', sa.Float(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('event_sessions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_event_sessions_project_id'), ['project_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_event_sessions_video_id'), ['video_id'], unique=False)

    op.create_table('extracted_facts',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('project_id', sa.String(length=64), nullable=False),
    sa.Column('video_id', sa.String(length=64), nullable=False),
    sa.Column('segment_id', sa.String(length=64), nullable=True),
    sa.Column('kind', sa.String(length=30), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('speaker_id', sa.String(length=64), nullable=True),
    sa.Column('timestamp', sa.Float(), nullable=False),
    sa.Column('provenance', sa.String(length=30), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('confidence', sa.Float(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('extracted_facts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_extracted_facts_project_id'), ['project_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_extracted_facts_video_id'), ['video_id'], unique=False)

    op.create_table('magazine_pages',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('project_id', sa.String(length=64), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('page_type', sa.String(length=40), nullable=False),
    sa.Column('template_id', sa.String(length=120), nullable=False),
    sa.Column('label', sa.String(length=300), nullable=False),
    sa.Column('article_id', sa.String(length=64), nullable=True),
    sa.Column('article_part', sa.Integer(), nullable=True),
    sa.Column('elements', JSONType, nullable=False),
    sa.Column('editorial_status', sa.String(length=20), nullable=False),
    sa.Column('design_status', sa.String(length=20), nullable=False),
    sa.Column('locked', sa.Boolean(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('magazine_pages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_magazine_pages_position'), ['position'], unique=False)
        batch_op.create_index(batch_op.f('ix_magazine_pages_project_id'), ['project_id'], unique=False)

    op.create_table('reference_pages',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('reference_id', sa.String(length=64), nullable=False),
    sa.Column('page_number', sa.Integer(), nullable=False),
    sa.Column('layout_type', sa.String(length=40), nullable=False),
    sa.Column('confidence', sa.Float(), nullable=False),
    sa.Column('width_pt', sa.Float(), nullable=False),
    sa.Column('height_pt', sa.Float(), nullable=False),
    sa.Column('blocks', JSONType, nullable=False),
    sa.Column('properties', JSONType, nullable=False),
    sa.Column('corrected', sa.Boolean(), nullable=False),
    sa.Column('features', JSONType, nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['reference_id'], ['reference_magazines.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('reference_id', 'page_number', name='uq_reference_page')
    )
    with op.batch_alter_table('reference_pages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_reference_pages_reference_id'), ['reference_id'], unique=False)

    op.create_table('speakers',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('project_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('designation', sa.String(length=300), nullable=True),
    sa.Column('organisation', sa.String(length=300), nullable=True),
    sa.Column('verification', sa.String(length=20), nullable=False),
    sa.Column('video_ids', JSONType, nullable=False),
    sa.Column('labels', JSONType, nullable=False),
    sa.Column('bio', sa.Text(), nullable=True),
    sa.Column('portrait_asset_id', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('speakers', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_speakers_project_id'), ['project_id'], unique=False)

    op.create_table('video_sources',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('org_id', sa.String(length=64), nullable=False),
    sa.Column('project_id', sa.String(length=64), nullable=False),
    sa.Column('source_type', sa.String(length=20), nullable=False),
    sa.Column('url', sa.Text(), nullable=True),
    sa.Column('external_id', sa.String(length=200), nullable=True),
    sa.Column('file_name', sa.String(length=400), nullable=True),
    sa.Column('file_size_bytes', sa.BigInteger(), nullable=True),
    sa.Column('mime_type', sa.String(length=120), nullable=True),
    sa.Column('title', sa.String(length=400), nullable=False),
    sa.Column('duration_sec', sa.Float(), nullable=True),
    sa.Column('thumbnail_url', sa.Text(), nullable=True),
    sa.Column('session_id', sa.String(length=64), nullable=True),
    sa.Column('storage_key', sa.String(length=600), nullable=True),
    sa.Column('audio_key', sa.String(length=600), nullable=True),
    sa.Column('processing_state', sa.String(length=30), nullable=False),
    sa.Column('processing_progress', sa.Float(), nullable=False),
    sa.Column('processing_message', sa.Text(), nullable=True),
    sa.Column('processing_updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('transcription_state', sa.String(length=30), nullable=False),
    sa.Column('transcription_method', sa.String(length=30), nullable=True),
    sa.Column('transcription_language', sa.String(length=20), nullable=True),
    sa.Column('word_count', sa.Integer(), nullable=True),
    sa.Column('captions_status', sa.String(length=20), nullable=False),
    sa.Column('analysis_complete', sa.Boolean(), nullable=False),
    sa.Column('added_by', sa.String(length=64), nullable=True),
    sa.Column('simulated', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('video_sources', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_video_sources_org_id'), ['org_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_video_sources_project_id'), ['project_id'], unique=False)

    op.create_table('transcript_segments',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('project_id', sa.String(length=64), nullable=False),
    sa.Column('video_id', sa.String(length=64), nullable=False),
    sa.Column('idx', sa.Integer(), nullable=False),
    sa.Column('start', sa.Float(), nullable=False),
    sa.Column('end', sa.Float(), nullable=False),
    sa.Column('speaker_id', sa.String(length=64), nullable=True),
    sa.Column('speaker_label', sa.String(length=120), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['video_id'], ['video_sources.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('transcript_segments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_transcript_segments_project_id'), ['project_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_transcript_segments_video_id'), ['video_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('transcript_segments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_transcript_segments_video_id'))
        batch_op.drop_index(batch_op.f('ix_transcript_segments_project_id'))

    op.drop_table('transcript_segments')
    with op.batch_alter_table('video_sources', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_video_sources_project_id'))
        batch_op.drop_index(batch_op.f('ix_video_sources_org_id'))

    op.drop_table('video_sources')
    with op.batch_alter_table('speakers', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_speakers_project_id'))

    op.drop_table('speakers')
    with op.batch_alter_table('reference_pages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_reference_pages_reference_id'))

    op.drop_table('reference_pages')
    with op.batch_alter_table('magazine_pages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_magazine_pages_project_id'))
        batch_op.drop_index(batch_op.f('ix_magazine_pages_position'))

    op.drop_table('magazine_pages')
    with op.batch_alter_table('extracted_facts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_extracted_facts_video_id'))
        batch_op.drop_index(batch_op.f('ix_extracted_facts_project_id'))

    op.drop_table('extracted_facts')
    with op.batch_alter_table('event_sessions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_event_sessions_video_id'))
        batch_op.drop_index(batch_op.f('ix_event_sessions_project_id'))

    op.drop_table('event_sessions')
    with op.batch_alter_table('design_profiles', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_design_profiles_reference_id'))
        batch_op.drop_index(batch_op.f('ix_design_profiles_org_id'))

    op.drop_table('design_profiles')
    with op.batch_alter_table('assets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_assets_project_id'))
        batch_op.drop_index(batch_op.f('ix_assets_org_id'))

    op.drop_table('assets')
    with op.batch_alter_table('articles', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_articles_project_id'))

    op.drop_table('articles')
    with op.batch_alter_table('reference_magazines', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_reference_magazines_org_id'))

    op.drop_table('reference_magazines')
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_projects_org_id'))

    op.drop_table('projects')
    with op.batch_alter_table('password_reset_tokens', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_password_reset_tokens_user_id'))
        batch_op.drop_index(batch_op.f('ix_password_reset_tokens_token_hash'))

    op.drop_table('password_reset_tokens')
    with op.batch_alter_table('oauth_tokens', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_oauth_tokens_user_id'))
        batch_op.drop_index(batch_op.f('ix_oauth_tokens_org_id'))

    op.drop_table('oauth_tokens')
    with op.batch_alter_table('memberships', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_memberships_user_id'))
        batch_op.drop_index(batch_op.f('ix_memberships_org_id'))

    op.drop_table('memberships')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_email'))

    op.drop_table('users')
    with op.batch_alter_table('templates', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_templates_org_id'))

    op.drop_table('templates')
    with op.batch_alter_table('organisations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_organisations_slug'))

    op.drop_table('organisations')
    with op.batch_alter_table('jobs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_jobs_status'))
        batch_op.drop_index(batch_op.f('ix_jobs_queue'))
        batch_op.drop_index(batch_op.f('ix_jobs_org_id'))
        batch_op.drop_index(batch_op.f('ix_jobs_kind'))

    op.drop_table('jobs')
    op.drop_table('indesign_bridges')
    with op.batch_alter_table('exports', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_exports_project_id'))
        batch_op.drop_index(batch_op.f('ix_exports_org_id'))

    op.drop_table('exports')
    with op.batch_alter_table('approvals', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_approvals_target_id'))
        batch_op.drop_index(batch_op.f('ix_approvals_project_id'))
        batch_op.drop_index(batch_op.f('ix_approvals_org_id'))

    op.drop_table('approvals')
    with op.batch_alter_table('activity', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_activity_project_id'))
        batch_op.drop_index(batch_op.f('ix_activity_org_id'))

    op.drop_table('activity')
