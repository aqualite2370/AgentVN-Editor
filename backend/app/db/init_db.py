"""Database schema initialization."""

import sqlite3


def init_db(conn: sqlite3.Connection) -> None:
    """Create all local tables when missing."""

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS frozen_memory (
            character_id TEXT PRIMARY KEY,
            profile TEXT NOT NULL,
            speaking_style TEXT,
            background_story TEXT
        );

        CREATE TABLE IF NOT EXISTS relational_graph (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            relation TEXT NOT NULL,
            valid_since_chapter INTEGER NOT NULL,
            invalidated_at_chapter INTEGER,
            is_active INTEGER NOT NULL DEFAULT 1,
            confidence REAL NOT NULL DEFAULT 1.0,
            source_scene_id TEXT,
            note TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_relational_graph_active
            ON relational_graph (is_active, source, target);

        CREATE TABLE IF NOT EXISTS episodic_memory (
            id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL,
            summary TEXT NOT NULL,
            embedding TEXT NOT NULL,
            memory_strength REAL NOT NULL,
            original_emotion TEXT NOT NULL,
            current_emotion TEXT NOT NULL,
            created_at_chapter INTEGER NOT NULL,
            last_accessed_chapter INTEGER NOT NULL,
            source_scene_id TEXT,
            valence REAL NOT NULL DEFAULT 0.0,
            arousal REAL NOT NULL DEFAULT 0.0,
            dominance REAL NOT NULL DEFAULT 0.0
        );

        CREATE INDEX IF NOT EXISTS idx_episodic_memory_character
            ON episodic_memory (character_id, last_accessed_chapter);

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS editor_shared_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS editor_project_summaries (
            project_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT NOT NULL,
            node_count INTEGER NOT NULL DEFAULT 0,
            edge_count INTEGER NOT NULL DEFAULT 0,
            schema_version TEXT,
            has_detail INTEGER NOT NULL DEFAULT 0,
            display_order INTEGER NOT NULL DEFAULT 0,
            summary_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_editor_project_summaries_order
            ON editor_project_summaries (display_order, updated_at DESC);

        CREATE TABLE IF NOT EXISTS editor_project_details (
            project_id TEXT PRIMARY KEY,
            project_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id)
                REFERENCES editor_project_summaries (project_id)
                ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS novel_processing_records (
            kind TEXT NOT NULL,
            id TEXT NOT NULL,
            book_id TEXT,
            job_id TEXT,
            chapter_id TEXT,
            chunk_id TEXT,
            value TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (kind, id)
        );

        CREATE INDEX IF NOT EXISTS idx_novel_processing_book
            ON novel_processing_records (kind, book_id);

        CREATE INDEX IF NOT EXISTS idx_novel_processing_job
            ON novel_processing_records (kind, job_id);

        CREATE INDEX IF NOT EXISTS idx_novel_processing_chapter
            ON novel_processing_records (kind, chapter_id);

        CREATE INDEX IF NOT EXISTS idx_novel_processing_chunk
            ON novel_processing_records (kind, chunk_id);
        """
    )
    conn.commit()
