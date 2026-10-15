"""Generate a PDF meeting report from AI intelligence artifacts."""
from __future__ import annotations

import io
from datetime import datetime
from typing import Any


def _safe_str(val: Any, max_len: int = 0) -> str:
    s = str(val or "").strip()
    if max_len and len(s) > max_len:
        return s[:max_len] + "..."
    return s


def generate_meeting_pdf(
    *,
    room_name: str,
    title: str,
    created_at: str | None,
    ended_at: str | None,
    notes: list[dict],
    action_items: list[dict],
    decisions: list[dict],
    transcripts: list[dict],
) -> bytes:
    """Return PDF bytes for a meeting report."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        HRFlowable,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=18, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=13, spaceBefore=12, spaceAfter=4)
    body = styles["Normal"]
    meta_style = ParagraphStyle("meta", parent=styles["Normal"], fontSize=9, textColor=colors.grey)
    bullet = ParagraphStyle("bullet", parent=styles["Normal"], leftIndent=12, bulletIndent=0, spaceAfter=2)

    elements = []

    # Header
    elements.append(Paragraph(_safe_str(title) or "Meeting Report", h1))
    elements.append(Paragraph(f"Room: {room_name}", meta_style))
    if created_at:
        elements.append(Paragraph(f"Started: {created_at}", meta_style))
    if ended_at:
        elements.append(Paragraph(f"Ended: {ended_at}", meta_style))
    elements.append(Paragraph(f"Exported: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", meta_style))
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.lightgrey, spaceAfter=8))

    # Summaries (notes with type starting "summary:")
    summaries = [n for n in notes if _safe_str(n.get("type")).startswith("summary:")]
    if summaries:
        elements.append(Paragraph("Meeting Summary", h2))
        for s in summaries:
            elements.append(Paragraph(_safe_str(s.get("content")), body))
            elements.append(Spacer(1, 4))

    # Key Points (notes not classified as summary)
    key_points = [n for n in notes if not _safe_str(n.get("type")).startswith("summary:")]
    if key_points:
        elements.append(Paragraph("Key Points", h2))
        current_section = None
        for note in key_points:
            section = _safe_str(note.get("section")) or _safe_str(note.get("type")).removeprefix("key_point:")
            if section and section != current_section:
                elements.append(Paragraph(f"<b>{section}</b>", bullet))
                current_section = section
            content = _safe_str(note.get("content"))
            if content:
                elements.append(Paragraph(f"• {content}", bullet))

    # Action Items
    if action_items:
        elements.append(Paragraph("Action Items", h2))
        table_data = [["#", "Task", "Assigned To", "Status"]]
        for i, item in enumerate(action_items, 1):
            table_data.append([
                str(i),
                _safe_str(item.get("title"), 80),
                _safe_str(item.get("assigned_to")) or "—",
                _safe_str(item.get("status")) or "pending",
            ])
        t = Table(table_data, colWidths=[10 * mm, 100 * mm, 40 * mm, 25 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4F46E5")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, 0), 10),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("WORDWRAP", (1, 1), (1, -1), True),
        ]))
        elements.append(t)

    # Decisions
    if decisions:
        elements.append(Paragraph("Decisions", h2))
        for d in decisions:
            title_text = _safe_str(d.get("title"), 120)
            elements.append(Paragraph(f"<b>{title_text}</b>", body))
            if d.get("chosen"):
                elements.append(Paragraph(f"Chosen: {_safe_str(d['chosen'])}", bullet))
            if d.get("analysis"):
                elements.append(Paragraph(_safe_str(d["analysis"], 400), bullet))
            elements.append(Spacer(1, 6))

    # Transcript (abbreviated — only first 100 segments to keep PDF manageable)
    if transcripts:
        elements.append(Paragraph("Transcript", h2))
        shown = transcripts[:100]
        for seg in shown:
            speaker = _safe_str(seg.get("speaker")) or "Participant"
            text = _safe_str(seg.get("text"))
            if text:
                elements.append(Paragraph(f"<b>[{speaker}]</b> {text}", bullet))
        if len(transcripts) > 100:
            elements.append(Paragraph(f"… ({len(transcripts) - 100} more segments omitted)", meta_style))

    doc.build(elements)
    return buf.getvalue()
