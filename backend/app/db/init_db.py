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

        CREATE TABLE IF NOT EXISTS assistant_creation_processes (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL UNIQUE,
            project_id TEXT NOT NULL,
            project_title TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN (
                'queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled'
            )),
            submitted_at INTEGER NOT NULL,
            started_at INTEGER,
            finished_at INTEGER,
            worker_id TEXT,
            lease_until INTEGER,
            payload_json TEXT NOT NULL,
            result_json TEXT,
            error_code TEXT,
            error_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_assistant_creation_status_sequence
            ON assistant_creation_processes (status, sequence);
        CREATE INDEX IF NOT EXISTS idx_assistant_creation_project
            ON assistant_creation_processes (project_id, status);

        CREATE TABLE IF NOT EXISTS assistant_creation_tool_events (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            process_id TEXT NOT NULL,
            tool TEXT NOT NULL,
            status TEXT NOT NULL,
            time INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_assistant_creation_tools
            ON assistant_creation_tool_events (process_id, sequence);
        CREATE TABLE IF NOT EXISTS assistant_creation_local_tools (
            id TEXT PRIMARY KEY,
            process_id TEXT NOT NULL,
            action TEXT NOT NULL,
            status TEXT NOT NULL,
            draft_json TEXT NOT NULL,
            result_json TEXT,
            created_at INTEGER NOT NULL
        );
        """
    )
    summary_columns = {
        row[1]
        for row in conn.execute("PRAGMA table_info(editor_project_summaries)").fetchall()
    }
    if "size_bytes" not in summary_columns:
        conn.execute(
            "ALTER TABLE editor_project_summaries ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0"
        )
    conn.commit()
