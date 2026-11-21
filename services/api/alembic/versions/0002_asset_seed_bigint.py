"""Widen assets.seed to 64 bits.

Seeds are the first 32 bits of a SHA-256, so about half of them exceed a signed 32-bit INTEGER. SQLite stores any
integer, which hid this; PostgreSQL rejected those inserts ("integer out of range"), failing roughly every second
picture upload, AI image, CMS import and reference-cover logo.

Revision ID: 0002_asset_seed_bigint
Revises: 0001_initial
Create Date: 2026-11-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0002_asset_seed_bigint'
down_revision: Union[str, None] = '0001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('assets', schema=None) as batch_op:
        batch_op.alter_column('seed', existing_type=sa.Integer(), type_=sa.BigInteger(), existing_nullable=False)


def downgrade() -> None:
    with op.batch_alter_table('assets', schema=None) as batch_op:
        batch_op.alter_column('seed', existing_type=sa.BigInteger(), type_=sa.Integer(), existing_nullable=False)
