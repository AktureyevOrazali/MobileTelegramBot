        operator_bin_filter_params = list(operator_assigned_bins)

    with _lock:
        # ══════════════════════════════════════════════════════
        # 1. CLOSED DIALOGS — from dialog_stats (pre-aggregated)
        # ══════════════════════════════════════════════════════
        agg_row = execute(
            """
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(msg_incoming), 0) AS incoming,
                COALESCE(SUM(msg_outgoing), 0) AS outgoing,
                COALESCE(SUM(msg_total), 0) AS messages,
                COALESCE(SUM(CASE WHEN is_ai_closed THEN 1 ELSE 0 END), 0) AS ai_closed,
                COALESCE(SUM(ai_messages_count), 0) AS ai_msgs,
                COALESCE(SUM(response_count), 0) AS resp_count,
                COALESCE(SUM(fast_responses), 0) AS fast,
                COALESCE(SUM(medium_responses), 0) AS medium,
                COALESCE(SUM(slow_responses), 0) AS slow,
                COALESCE(SUM(sla_violations), 0) AS sla_v,
                AVG(msgs_before_transfer) AS avg_before_transfer,
                AVG(first_message_length) AS avg_first_msg_len,
                COALESCE(SUM(CASE WHEN has_contract = true THEN 1 ELSE 0 END), 0) AS with_contract,
                COALESCE(SUM(CASE WHEN has_contract = false THEN 1 ELSE 0 END), 0) AS without_contract
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchone()

        closed_dialogs = int(agg_row["total"] or 0)
        closed_incoming = int(agg_row["incoming"] or 0)
        closed_outgoing = int(agg_row["outgoing"] or 0)
        closed_messages = int(agg_row["messages"] or 0)
        ai_closed_dialogs = int(agg_row["ai_closed"] or 0)
        ai_messages_count = int(agg_row["ai_msgs"] or 0)
        total_resp_count = int(agg_row["resp_count"] or 0)
        fast_responses = int(agg_row["fast"] or 0)
        medium_responses = int(agg_row["medium"] or 0)
        slow_responses = int(agg_row["slow"] or 0)
        sla_violations_count = int(agg_row["sla_v"] or 0)
        avg_messages_before_transfer = (
            float(agg_row["avg_before_transfer"])
            if agg_row["avg_before_transfer"] is not None else None
        )
        average_first_message_length = (
            float(agg_row["avg_first_msg_len"])
            if agg_row["avg_first_msg_len"] is not None else None
        )
        requests_with_contract = int(agg_row["with_contract"] or 0)
        requests_without_contract = int(agg_row["without_contract"] or 0)

        # Weighted average response time from dialog_stats
        avg_rt_row = execute(
            """
            SELECT SUM(avg_response_time_seconds * response_count) / NULLIF(SUM(response_count), 0) AS weighted_avg
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
              AND avg_response_time_seconds IS NOT NULL
            """
            + operator_bin_filter_sql,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchone()
        avg_response_time_seconds: Optional[float] = (
            float(avg_rt_row["weighted_avg"])
            if avg_rt_row and avg_rt_row["weighted_avg"] is not None else None
        )

        transferred_to_operator_dialogs = max(0, closed_dialogs - ai_closed_dialogs)

        # ══════════════════════════════════════════════════════
        # 2. OPEN DIALOGS — live from chat_dialogs + messages
        # ══════════════════════════════════════════════════════
        open_filter = operator_bin_filter_sql.replace("ds.", "cd.")
        open_params = list(operator_bin_filter_params)

        open_row = execute(
            """
            SELECT COUNT(*) AS total
            FROM chat_dialogs cd
            WHERE cd.ended_at IS NULL
              AND cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchone()
        open_dialogs = int(open_row["total"] or 0)

        # Messages in open dialogs
        open_msg_row = execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN m.direction = 'incoming' THEN 1 ELSE 0 END), 0) AS incoming,
                COALESCE(SUM(CASE WHEN m.direction = 'outgoing' THEN 1 ELSE 0 END), 0) AS outgoing
            FROM messages m
            JOIN chat_dialogs cd ON cd.id = m.dialog_id
            WHERE cd.ended_at IS NULL
              AND cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchone()
        open_incoming = int(open_msg_row["incoming"] or 0)
        open_outgoing = int(open_msg_row["outgoing"] or 0)

        # ── Combined totals ──
        total_dialogs = closed_dialogs + open_dialogs
        total_incoming = closed_incoming + open_incoming
        total_outgoing = closed_outgoing + open_outgoing
        total_messages = closed_messages + open_incoming + open_outgoing

        # total_chats - from both live and deleted dialogs
        live_chats_row = execute(
            """
            SELECT COUNT(DISTINCT cd.chat_id) AS total FROM chat_dialogs cd
            WHERE cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchone()
        stats_chats_row = execute(
            """
            SELECT COUNT(DISTINCT ds.chat_id) AS total FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchone()
        total_chats = max(
            int(live_chats_row["total"] or 0),
            int(stats_chats_row["total"] or 0),
        )

        # ══════════════════════════════════════════════════════
        # 3. DERIVED METRICS
        # ══════════════════════════════════════════════════════
        average_messages_per_dialog = (
            total_messages / total_dialogs if total_dialogs else 0.0
        )
        avg_response_time_minutes: Optional[float] = (
            avg_response_time_seconds / 60.0
            if avg_response_time_seconds is not None else None
        )
        sla_compliance_percentage: Optional[float] = None
        if total_resp_count > 0:
            sla_compliance_percentage = (
                (total_resp_count - sla_violations_count) / total_resp_count
            ) * 100

        # Dialog duration (from dialog_stats)
        dur_row = execute(
            """
            SELECT AVG(
                EXTRACT(EPOCH FROM (CAST(ds.ended_at AS TIMESTAMP) - CAST(ds.started_at AS TIMESTAMP)))
            ) / 60.0 AS avg_min
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
              AND ds.ended_at IS NOT NULL
            """
            + operator_bin_filter_sql,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchone()
        avg_dialog_duration_minutes: Optional[float] = (
            float(dur_row["avg_min"]) if dur_row and dur_row["avg_min"] is not None else None
        )

        response_time_dialogs: List[dict] = []

        # ══════════════════════════════════════════════════════
        # 4. SECTION BREAKDOWN
        # ══════════════════════════════════════════════════════
        section_rows = execute(
            """
            SELECT ds.section, COUNT(*) AS dialog_count
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql
            + """
            GROUP BY ds.section
            """,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()

        open_section_rows = execute(
            """
            SELECT COALESCE(cd.section, (SELECT c.section FROM chats c WHERE c.chat_id = cd.chat_id)) AS section,
                   COUNT(*) AS dialog_count
            FROM chat_dialogs cd
            WHERE cd.ended_at IS NULL
              AND cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter
            + """
            GROUP BY section
            """,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchall()

        section_counts: Dict[Optional[str], int] = {}
        for row in section_rows:
            section_counts[row["section"]] = int(row["dialog_count"] or 0)
        for row in open_section_rows:
            key = row["section"]
            section_counts[key] = section_counts.get(key, 0) + int(row["dialog_count"] or 0)

        section_breakdown: List[dict] = []
        for sec_id, sec_dialogs in section_counts.items():
            if not sec_dialogs:
                continue
            title = section_map.get(sec_id or "", sec_id or "Без раздела")
            percentage = (sec_dialogs / total_dialogs * 100.0) if total_dialogs else 0.0
            section_breakdown.append({
                "section": sec_id,
                "title": title,
                "dialogs": sec_dialogs,
                "percentage": percentage,
            })
        section_breakdown.sort(key=lambda s: s["dialogs"], reverse=True)

        # ══════════════════════════════════════════════════════
        # 5. TOP QUESTIONS (from stat_questions)
        # ══════════════════════════════════════════════════════
        sq_bin_filter = ""
        sq_params: list = [start_iso, end_exclusive_iso]
        if operator_bin_filter_params:
            _sq_ph = ", ".join("%s" for _ in operator_bin_filter_params)
            sq_bin_filter = f"""
                AND sq.dialog_id IN (
                    SELECT ds2.dialog_id FROM dialog_stats ds2
                    WHERE ds2.bin IN ({_sq_ph})
                )
            """
            sq_params.extend(operator_bin_filter_params)

        question_rows = execute(
            """
            SELECT sq.text, sq.section, COUNT(*) AS cnt
            FROM stat_questions sq
            WHERE sq.created_at >= %s AND sq.created_at < %s
            """
            + sq_bin_filter
            + """
            GROUP BY sq.text, sq.section
            ORDER BY cnt DESC
            """,
            sq_params,
        ).fetchall()

        question_stats: Dict[str, dict] = {}
        section_question_stats: Dict[Optional[str], Dict[str, dict]] = {}
        for row in question_rows:
            text = (row["text"] or "").strip()
            if not text:
                continue
            normalized = text.lower()
            count = int(row["cnt"] or 0)
            entry = question_stats.get(normalized)
            if entry is None:
                entry = {"question": text, "count": 0}
                question_stats[normalized] = entry
            entry["count"] += count
            if len(text) < len(entry["question"]):
                entry["question"] = text

            section_id = (row["section"] or "").strip() or None
            section_bucket = section_question_stats.setdefault(section_id, {})
            section_entry = section_bucket.get(normalized)
            if section_entry is None:
                section_entry = {"question": text, "count": 0}
                section_bucket[normalized] = section_entry
            section_entry["count"] += count
            if len(text) < len(section_entry["question"]):
                section_entry["question"] = text

        sorted_questions = sorted(
            question_stats.values(), key=lambda item: -item["count"],
        )
        top_questions = [
            {"question": item["question"], "count": int(item["count"])}
            for item in sorted_questions[:max(questions_limit, 0)]
        ]

        questions_by_section: List[dict] = []
        for sec_id, bucket in section_question_stats.items():
            if not bucket:
                continue
            qs = sorted(bucket.values(), key=lambda item: -item["count"])
            questions_by_section.append({
                "section": sec_id,
                "title": section_map.get(sec_id or "", sec_id or "Без раздела"),
                "questions": [
                    {"question": item["question"], "count": int(item["count"])}
                    for item in qs[:max(questions_limit, 0)]
                ],
            })

        # ══════════════════════════════════════════════════════
        # 6. AGENT BREAKDOWN (from dialog_operator_stats)
        # ══════════════════════════════════════════════════════
        if operator_bin_filter_params:
            agent_rows = execute(
                """
                SELECT dos.operator_name,
                       SUM(dos.messages_sent) AS message_count,
                       COUNT(DISTINCT dos.dialog_id) AS dialog_count,
                       SUM(dos.avg_response_seconds * dos.response_count) / NULLIF(SUM(dos.response_count), 0) AS avg_response_time
                FROM dialog_operator_stats dos
                JOIN dialog_stats ds ON ds.dialog_id = dos.dialog_id
                WHERE dos.started_at >= %s AND dos.started_at < %s
                """
                + operator_bin_filter_sql
                + """
                GROUP BY dos.operator_name
                ORDER BY dialog_count DESC
                """,
                (start_iso, end_exclusive_iso, *operator_bin_filter_params),
            ).fetchall()
        else:
            agent_rows = execute(
                """
                SELECT operator_name,
                       SUM(messages_sent) AS message_count,
                       COUNT(DISTINCT dialog_id) AS dialog_count,
                       SUM(avg_response_seconds * response_count) / NULLIF(SUM(response_count), 0) AS avg_response_time
                FROM dialog_operator_stats
                WHERE started_at >= %s AND started_at < %s
                GROUP BY operator_name
                ORDER BY dialog_count DESC
                """,
                (start_iso, end_exclusive_iso),
            ).fetchall()

        agent_breakdown: List[dict] = []
        for row in agent_rows:
            agent_name = row["operator_name"] or "Без имени"
            messages_sent = int(row["message_count"] or 0)
            dialogs_handled = int(row["dialog_count"] or 0)
            avg_msgs = messages_sent / dialogs_handled if dialogs_handled else 0.0
            avg_rt = (
                float(row["avg_response_time"]) / 60.0
                if row["avg_response_time"] is not None else None
            )
            agent_breakdown.append({
                "name": agent_name,
                "messages": messages_sent,
                "dialogs": dialogs_handled,
                "avg_messages_per_dialog": avg_msgs,
                "avg_response_time_minutes": avg_rt,
                "last_activity": None,
            })

        # ══════════════════════════════════════════════════════
        # 7. RECENT ACTIVITY (by day)
        # ══════════════════════════════════════════════════════
        activity_rows = execute(
            """
            SELECT DATE(started_at) AS day, COUNT(*) AS cnt
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql
            + """
            GROUP BY day
            """,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()

        open_activity_rows = execute(
            """
            SELECT DATE(started_at) AS day, COUNT(*) AS cnt
            FROM chat_dialogs cd
            WHERE cd.ended_at IS NULL
              AND cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter
            + """
            GROUP BY day
            """,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchall()

        incoming_by_day_rows = execute(
            """
            SELECT DATE(sq.created_at) AS day, COUNT(*) AS cnt
            FROM stat_questions sq
            WHERE sq.created_at >= %s AND sq.created_at < %s
            """
            + sq_bin_filter
            + """
            GROUP BY day
            """,
            sq_params,
        ).fetchall()

        dialogs_by_day: Dict[str, int] = {}
        for row in activity_rows:
            dialogs_by_day[str(row["day"])] = int(row["cnt"] or 0)
        for row in open_activity_rows:
            day_key = str(row["day"])
            dialogs_by_day[day_key] = dialogs_by_day.get(day_key, 0) + int(row["cnt"] or 0)

        incoming_by_day: Dict[str, int] = {}
        for row in incoming_by_day_rows:
            incoming_by_day[str(row["day"])] = int(row["cnt"] or 0)

        recent_activity: List[dict] = []
        for offset in range(span):
            day = start_date + timedelta(days=offset)
            day_key = day.isoformat()
            recent_activity.append({
                "date": day_key,
                "dialogs": dialogs_by_day.get(day_key, 0),
                "incoming_messages": incoming_by_day.get(day_key, 0),
            })

        # ══════════════════════════════════════════════════════
        # 8. RECURRING REQUESTS (self-join on dialog_stats by BIN)
        # ══════════════════════════════════════════════════════
        recurring_requests_count = 0
        recurring_requests_percentage: Optional[float] = None
        _rec_bin_filter = operator_bin_filter_sql.replace("ds.", "ds2.")
        recurring_row = execute(
            """
            SELECT COUNT(DISTINCT ds2.dialog_id) AS recurring_count
            FROM dialog_stats ds1
            JOIN dialog_stats ds2 ON ds1.bin = ds2.bin
            WHERE ds1.ended_at IS NOT NULL
              AND ds2.started_at > ds1.ended_at
              AND CAST(ds2.started_at AS TIMESTAMP) <= CAST(ds1.ended_at AS TIMESTAMP) + INTERVAL '%s days'
              AND ds2.started_at >= %s AND ds2.started_at < %s
            """
            + _rec_bin_filter,
            (span, start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchone()
        recurring_requests_count = int(recurring_row["recurring_count"] or 0)

        total_period_dialogs = requests_with_contract + requests_without_contract
        if total_period_dialogs > 0:
            recurring_requests_percentage = (
                recurring_requests_count / total_period_dialogs
            ) * 100

        # ══════════════════════════════════════════════════════
        # 9. PEAK LOAD HEATMAP
        # ══════════════════════════════════════════════════════
        heatmap_rows = execute(
            """
            SELECT
                EXTRACT(ISODOW FROM CAST(ds.started_at AS TIMESTAMP WITH TIME ZONE) AT TIME ZONE 'Asia/Almaty') AS day_of_week,
                EXTRACT(HOUR FROM CAST(ds.started_at AS TIMESTAMP WITH TIME ZONE) AT TIME ZONE 'Asia/Almaty') AS hour_of_day,
                COUNT(*) AS count
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql
            + """
            GROUP BY day_of_week, hour_of_day
            """,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()

        peak_load_heatmap = [
            {
                "day_of_week": int(row["day_of_week"]) - 1,
                "hour": int(row["hour_of_day"]),
                "count": int(row["count"]),
            }
            for row in heatmap_rows
        ]

        # ══════════════════════════════════════════════════════
        # 10. CONTRACT ANALYTICS (top BINs)
        # ══════════════════════════════════════════════════════
        contract_rows = execute(
            """
            SELECT ds.bin, ds.has_contract, COUNT(*) AS dialog_count
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
              AND ds.bin IS NOT NULL
            """
            + operator_bin_filter_sql
            + """
            GROUP BY ds.bin, ds.has_contract
            """,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()

        top_bins_without_contract_raw = [
            {"bin": row["bin"] or "Неизвестно", "requests": int(row["dialog_count"])}
            for row in contract_rows if row["has_contract"] is False
        ]
        top_bins_without_contract_raw.sort(key=lambda x: x["requests"], reverse=True)
        top_bins_without_contract = top_bins_without_contract_raw[:10]

        top_bins_with_contract_raw = [
            {"bin": row["bin"] or "Неизвестно", "requests": int(row["dialog_count"])}
            for row in contract_rows if row["has_contract"] is True
        ]
        top_bins_with_contract_raw.sort(key=lambda x: x["requests"], reverse=True)
        top_bins_with_contract = top_bins_with_contract_raw[:10]

        # ══════════════════════════════════════════════════════
        # 11. DIALOG METRICS (for region map)
        # ══════════════════════════════════════════════════════
        dm_rows = execute(
            """
            SELECT dialog_id, bin, is_ai_closed, avg_response_time_seconds
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()

        dialog_metrics: List[dict] = []
        for row in dm_rows:
            rt_min = (
                float(row["avg_response_time_seconds"]) / 60.0
                if row["avg_response_time_seconds"] is not None else None
            )
            dialog_metrics.append({
                "dialog_id": int(row["dialog_id"]),
                "bin": row["bin"],
                "is_open": False,
                "is_ai_closed": bool(row["is_ai_closed"]),
                "response_time_minutes": rt_min,
            })

        # Add open dialogs to dialog_metrics
        open_dm_rows = execute(
            """
            SELECT cd.id AS dialog_id,
                   COALESCE(cd.bin, (SELECT c.bin FROM chats c WHERE c.chat_id = cd.chat_id)) AS bin
            FROM chat_dialogs cd
            WHERE cd.ended_at IS NULL
              AND cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchall()
        for row in open_dm_rows:
            dialog_metrics.append({
                "dialog_id": int(row["dialog_id"]),
                "bin": row["bin"],
                "is_open": True,
                "is_ai_closed": False,
                "response_time_minutes": None,
            })

    return {
        "total_dialogs": int(total_dialogs),
        "open_dialogs": int(open_dialogs),
        "closed_dialogs": int(closed_dialogs),
        "total_chats": int(total_chats),
        "total_messages": int(total_messages),
        "total_incoming_messages": int(total_incoming),
        "total_outgoing_messages": int(total_outgoing),
        "ai_closed_dialogs": int(ai_closed_dialogs),
        "transferred_to_operator_dialogs": int(transferred_to_operator_dialogs),
        "avg_messages_before_transfer": avg_messages_before_transfer,
        "ai_messages_count": int(ai_messages_count),
        "requests_with_contract": int(requests_with_contract),
        "requests_without_contract": int(requests_without_contract),
        "recurring_requests_count": int(recurring_requests_count),
        "recurring_requests_percentage": recurring_requests_percentage,
        "sla_violations_count": int(sla_violations_count),
        "sla_compliance_percentage": sla_compliance_percentage,
        "average_first_message_length": average_first_message_length,
        "average_messages_per_dialog": average_messages_per_dialog,
        "avg_dialog_duration_minutes": avg_dialog_duration_minutes,
        "avg_response_time_minutes": avg_response_time_minutes,
        "avg_response_time_seconds": avg_response_time_seconds,
        "response_time_dialogs": response_time_dialogs,
        "dialog_metrics": dialog_metrics,
        "section_breakdown": section_breakdown,
        "top_questions": top_questions,
        "questions_by_section": questions_by_section,
        "agent_breakdown": agent_breakdown,
        "recent_activity": recent_activity,
        "top_bins_without_contract": top_bins_without_contract,
        "top_bins_with_contract": top_bins_with_contract,
        "peak_load_heatmap": peak_load_heatmap,
        "updated_at": now.isoformat(),
    }
