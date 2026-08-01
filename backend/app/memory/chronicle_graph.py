"""ChronicleGraph: objective temporal relation graph."""

import sqlite3

from app.models.memory import NewRelation, RelationEdge
from app.utils.ids import new_id


class ChronicleGraph:
    """Stores objective facts as temporal relation edges."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def add_relation(self, relation: NewRelation, chapter: int) -> RelationEdge:
        edge = RelationEdge(
            id=new_id("rel"),
            source=relation.source,
            target=relation.target,
            relation=relation.relation,
            valid_since_chapter=chapter,
            confidence=relation.confidence,
            source_scene_id=relation.source_scene_id,
            note=relation.note,
        )
        self.conn.execute(
            """
            INSERT INTO relational_graph (
                id, source, target, relation, valid_since_chapter,
                invalidated_at_chapter, is_active, confidence, source_scene_id, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                edge.id,
                edge.source,
                edge.target,
                edge.relation,
                edge.valid_since_chapter,
                edge.invalidated_at_chapter,
                int(edge.is_active),
                edge.confidence,
                edge.source_scene_id,
                edge.note,
            ),
        )
        self.conn.commit()
        return edge

    def invalidate_relation(
        self,
        chapter: int,
        relation_id: str | None = None,
        source: str | None = None,
        target: str | None = None,
        relation: str | None = None,
    ) -> int:
        clauses = ["is_active = 1"]
        params: list[object] = []
        if relation_id:
            clauses.append("id = ?")
            params.append(relation_id)
        if source:
            clauses.append("source = ?")
            params.append(source)
        if target:
            clauses.append("target = ?")
            params.append(target)
        if relation:
            clauses.append("relation = ?")
            params.append(relation)
        params.extend([chapter])
        cursor = self.conn.execute(
            f"""
            UPDATE relational_graph
            SET is_active = 0, invalidated_at_chapter = ?
            WHERE {" AND ".join(clauses)}
            """,
            params[-1:] + params[:-1],
        )
        self.conn.commit()
        return cursor.rowcount

    def get_active_relations(self, source: str | None = None, target: str | None = None) -> list[RelationEdge]:
        return self._query_relations(active_only=True, source=source, target=target)

    def get_relation_history(self, source: str | None = None, target: str | None = None) -> list[RelationEdge]:
        return self._query_relations(active_only=False, source=source, target=target)

    def search_relations(self, query: str) -> list[RelationEdge]:
        like = f"%{query}%"
        rows = self.conn.execute(
            """
            SELECT * FROM relational_graph
            WHERE source LIKE ? OR target LIKE ? OR relation LIKE ? OR note LIKE ?
            ORDER BY is_active DESC, valid_since_chapter DESC
            """,
            (like, like, like, like),
        ).fetchall()
        return [self._row_to_edge(row) for row in rows]

    def _query_relations(
        self,
        active_only: bool,
        source: str | None = None,
        target: str | None = None,
    ) -> list[RelationEdge]:
        clauses: list[str] = []
        params: list[object] = []
        if active_only:
            clauses.append("is_active = 1")
        if source:
            clauses.append("source = ?")
            params.append(source)
        if target:
            clauses.append("target = ?")
            params.append(target)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self.conn.execute(
            f"SELECT * FROM relational_graph {where} ORDER BY valid_since_chapter DESC",
            params,
        ).fetchall()
        return [self._row_to_edge(row) for row in rows]

    @staticmethod
    def _row_to_edge(row: sqlite3.Row) -> RelationEdge:
        return RelationEdge(
            id=row["id"],
            source=row["source"],
            target=row["target"],
            relation=row["relation"],
            valid_since_chapter=row["valid_since_chapter"],
            invalidated_at_chapter=row["invalidated_at_chapter"],
            is_active=bool(row["is_active"]),
            confidence=row["confidence"],
            source_scene_id=row["source_scene_id"],
            note=row["note"],
        )
