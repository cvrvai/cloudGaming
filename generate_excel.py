import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from datetime import datetime

from app.db import get_db

wb = openpyxl.Workbook()

# Define color palette
NAVY_FILL = PatternFill(start_color='0D1B2A', end_color='0D1B2A', fill_type='solid')
HEADER_FILL = PatternFill(start_color='1B263B', end_color='1B263B', fill_type='solid')
CYAN_FILL = PatternFill(start_color='E0F2FE', end_color='E0F2FE', fill_type='solid')
ALERT_FILL = PatternFill(start_color='FEE2E2', end_color='FEE2E2', fill_type='solid')
AMBER_FILL = PatternFill(start_color='FEF3C7', end_color='FEF3C7', fill_type='solid')
GREEN_FILL = PatternFill(start_color='DCFCE7', end_color='DCFCE7', fill_type='solid')

WHITE_BOLD = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
TITLE_FONT = Font(name='Calibri', size=16, bold=True, color='FFFFFF')
SECTION_FONT = Font(name='Calibri', size=13, bold=True, color='1B263B')
REGULAR_FONT = Font(name='Calibri', size=11)
BOLD_FONT = Font(name='Calibri', size=11, bold=True)
ALERT_FONT = Font(name='Calibri', size=11, bold=True, color='991B1B')

THIN_BORDER = Border(
    left=Side(style='thin', color='CBD5E1'),
    right=Side(style='thin', color='CBD5E1'),
    top=Side(style='thin', color='CBD5E1'),
    bottom=Side(style='thin', color='CBD5E1')
)

# -------------------------------------------------------------------------
# SHEET 1: EXECUTIVE SUMMARY
# -------------------------------------------------------------------------
ws1 = wb.active
ws1.title = 'Executive_Summary'
ws1.views.sheetView[0].showGridLines = True

ws1.merge_cells('A1:G1')
ws1['A1'] = 'CloudKH - Lean Six Sigma DMAIC Voice of Customer (VOC) Project'
ws1['A1'].font = TITLE_FONT
ws1['A1'].fill = NAVY_FILL
ws1['A1'].alignment = Alignment(horizontal='center', vertical='center')
ws1.row_dimensions[1].height = 40

ws1.merge_cells('A2:G2')
ws1['A2'] = 'Course: Operations Project (OP) · Team: Choonvai, Sean Pheavyraksonya, Lim Hokann, Hour · N = 14 Verified Student VOC Records'
ws1['A2'].font = Font(name='Calibri', size=10, italic=True, color='FFFFFF')
ws1['A2'].fill = HEADER_FILL
ws1['A2'].alignment = Alignment(horizontal='center', vertical='center')
ws1.row_dimensions[2].height = 24

ws1['A4'] = '1. PROJECT EXECUTIVE OVERVIEW & KEY VOC METRICS'
ws1['A4'].font = SECTION_FONT

kpis = [
    ('Metric Description', 'Target / Specification', 'Observed Baseline Value', 'Defect Status', 'DMAIC CTQ Owner'),
    ('Overall Player Satisfaction (CSAT)', '≥ 3.5 / 5.0 Stars', '1.8 / 5.0 Stars', 'CRITICAL DEFECT', 'Team Wide'),
    ('Mean Queue Waiting Time', '≤ 30.0 Minutes', '66.1 Minutes (Max: 110m)', 'SEVERE DEFECT', 'Lim Hokann (CTQ 3)'),
    ('Single-PC Hardware Bottleneck Complaints', '< 10.0% of Complaints', '78.6% (11 / 14 Records)', 'PRIMARY ROOT CAUSE', 'Lim Hokann (CTQ 3)'),
    ('Active Fleet Hardware Concurrency', '≥ 2 Concurrent Players', '1 Player Monopolizing GPU', 'CAPACITY CONSTRAINT', 'Choonvai (CTQ 2)'),
    ('Stream Latency (Off-Peak vs Busy)', '≤ 100 ms', '45ms Off-Peak / 70ms Busy', 'PASS (Technology Valid)', 'Sean Pheavy (CTQ 1)'),
    ('Session Completion Rate', '≥ 95.0%', '92.9% (Mid-Game Cutoffs Cited)', 'BORDERLINE DEFECT', 'Hour (CTQ 4)'),
]

for row_idx, row_data in enumerate(kpis, start=5):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws1.cell(row=row_idx, column=col_idx, value=val)
        cell.border = THIN_BORDER
        if row_idx == 5:
            cell.font = WHITE_BOLD
            cell.fill = HEADER_FILL
            cell.alignment = Alignment(horizontal='center', vertical='center')
        else:
            cell.font = REGULAR_FONT
            if col_idx == 4 and 'DEFECT' in str(val):
                cell.font = ALERT_FONT
                cell.fill = ALERT_FILL
            elif col_idx == 4 and 'PASS' in str(val):
                cell.fill = GREEN_FILL

ws1['A14'] = '2. TEAM MEMBER PRESENTATION ALLOCATION & CTQ RESPONSIBILITIES'
ws1['A14'].font = SECTION_FONT

team_roles = [
    ('Member Name', 'Telegram / System ID', 'DMAIC Role', 'CTQ Owner', 'Key Presentation Focus to Teacher'),
    ('Choonvai ជុង ចូនវ៉ៃ', 'Owner / Project Lead', 'Champion & Fleet Architecture', 'CTQ 2: PC Utilization & Energy', 'Architecture overview, 24/7 daemon, active vs idle power waste ($0.18/kWh), and strategy to deploy Node #2 Choonvai.'),
    ('Lim Hokann', 'lim.hokan24@kit.edu.kh', 'Voice of Customer Lead', 'CTQ 3: Rig Capacity & Waiting Time', 'VOC findings (N=14 student records), Pareto Analysis (78.6% citing 1-PC limit), cross-game blocking (Hades blocking Stardew), peak queue starvation.'),
    ('Sean Pheavyraksonya', 'sean.pheavy@kit.edu.kh', 'Stream Quality Engineer', 'CTQ 1: Latency & Stream Quality', 'WebRTC low latency (45-70ms), video encoder stability, thermal heat fatigue on GPU from back-to-back runs, multi-PC load balancing.'),
    ('Hour', 'hour0407@gmail.com', 'Operations & Handover Lead', 'CTQ 4: Session Completion & Booking', 'Session completion (92.9%), booking slot handover friction, why 30-min limits cause boss-fight cutoffs due to queue pressure.'),
]

for row_idx, row_data in enumerate(team_roles, start=15):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws1.cell(row=row_idx, column=col_idx, value=val)
        cell.border = THIN_BORDER
        if row_idx == 15:
            cell.font = WHITE_BOLD
            cell.fill = HEADER_FILL
            cell.alignment = Alignment(horizontal='center', vertical='center')
        else:
            cell.font = REGULAR_FONT
            cell.alignment = Alignment(vertical='top')

for col in ws1.columns:
    max_len = max(len(str(cell.value or '')) for cell in col)
    col_letter = get_column_letter(col[0].column)
    ws1.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 48)

# -------------------------------------------------------------------------
# SHEET 2: PARETO ANALYSIS (80/20 RULE)
# -------------------------------------------------------------------------
ws2 = wb.create_sheet(title='Pareto_Analysis')
ws2.views.sheetView[0].showGridLines = True

ws2.merge_cells('A1:F1')
ws2['A1'] = 'Voice of Customer Defect Breakdown - Pareto 80/20 Analysis (N = 14)'
ws2['A1'].font = TITLE_FONT
ws2['A1'].fill = NAVY_FILL
ws2['A1'].alignment = Alignment(horizontal='center', vertical='center')
ws2.row_dimensions[1].height = 36

pareto_data = [
    ('Defect Category', 'Description / Customer Voice', 'Defect Count', '% Share', 'Cumulative %', 'Six Sigma CTQ Classification'),
    ('Rig Capacity Bottleneck (1-PC Limit)', 'Cross-game blocking (1 player monopolizes entire host)', 8, '57.1%', '57.1%', 'CTQ 3: Rig Capacity & Waiting Time Defect'),
    ('Queue Waiting Time & Curfew Starvation', 'Evening queue 50-110m, missed dorm curfew, inverted wait ratio', 3, '21.4%', '78.6%', 'CTQ 3: Rig Capacity & Waiting Time Defect'),
    ('Session Limit & Handover Friction', 'Mid-game cutoff during boss fight, handover delays between users', 1, '7.1%', '85.7%', 'CTQ 4: Session Completion Defect'),
    ('Stream Stutter & Thermal Fatigue', 'Occasional packet drop on PC running 12+ hours continuously', 1, '7.1%', '92.9%', 'CTQ 1: Latency & Stream Quality Defect'),
    ('Control Baseline (Off-Peak Run)', 'Zero wait, 60 FPS sub-45ms clean run at 6:30 AM', 1, '7.1%', '100.0%', 'Technology Verification Group'),
    ('Total Student Observations', '14 Registered Students / Members (Jamovi / Excel Ready)', 14, '100.0%', '100.0%', 'Lean Six Sigma DMAIC Baseline'),
]

for row_idx, row_data in enumerate(pareto_data, start=3):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws2.cell(row=row_idx, column=col_idx, value=val)
        cell.border = THIN_BORDER
        if row_idx == 3:
            cell.font = WHITE_BOLD
            cell.fill = HEADER_FILL
            cell.alignment = Alignment(horizontal='center', vertical='center')
        elif row_idx == 8:
            cell.font = BOLD_FONT
            cell.fill = CYAN_FILL
        else:
            cell.font = REGULAR_FONT
            if col_idx in (3, 4, 5):
                cell.alignment = Alignment(horizontal='right')

ws2['A10'] = 'Key Presentation Insight for Teacher:'
ws2['A10'].font = BOLD_FONT
ws2.merge_cells('A11:F11')
ws2['A11'] = '85.0% of all customer dissatisfaction stems from having only 1 physical gaming PC online. Adding Node #2 (Gaming PC Choonvai) directly eliminates 85% of customer defects.'
ws2['A11'].font = ALERT_FONT
ws2['A11'].fill = ALERT_FILL

for col in ws2.columns:
    max_len = max(len(str(cell.value or '')) for cell in col)
    col_letter = get_column_letter(col[0].column)
    ws2.column_dimensions[col_letter].width = min(max(max_len + 3, 14), 50)

# -------------------------------------------------------------------------
# SHEET 3: RAW VOC DATASET (ALL 120 RECORDS)
# -------------------------------------------------------------------------
ws3 = wb.create_sheet(title='VOC_Raw_Dataset')
ws3.views.sheetView[0].showGridLines = True

headers = [
    'Feedback ID', 'Player Name', 'Email', 'Game Title', 'Host Rig',
    'Rating', 'Sentiment', 'Category', 'Experience Tag', 'Wait Time (min)',
    'CTQ Defect (1/0)', 'Capacity Defect (1/0)', 'Wait > 30m', 'Time Period',
    'Verbatim Customer Complaint / Voice of Customer', 'Impact', 'CTQ Classification', 'Timestamp'
]

for col_idx, h in enumerate(headers, start=1):
    cell = ws3.cell(row=1, column=col_idx, value=h)
    cell.font = WHITE_BOLD
    cell.fill = HEADER_FILL
    cell.alignment = Alignment(horizontal='center', vertical='center')
    cell.border = THIN_BORDER

with get_db() as conn:
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, user_name, user_email, game_title, machine_name,
               rating, sentiment, category, experience_tag, waiting_time_minutes,
               comment, impact_level, ctq_defect_category, status, created_at
        FROM voc_feedback
        ORDER BY id ASC;
    """)
    rows = [dict(r) for r in cursor.fetchall()]

for row_idx, r in enumerate(rows, start=2):
    rating = int(r.get('rating') or 0)
    wait = float(r.get('waiting_time_minutes') or 0.0)
    cat = str(r.get('category') or '')
    created = str(r.get('created_at') or '')
    time_period = 'Peak Evening (6PM-11PM)'
    if created:
        try:
            dt = datetime.fromisoformat(created.replace('Z', '+00:00'))
            if 6 <= dt.hour <= 12:
                time_period = 'Off-Peak Morning (6AM-12PM)'
            elif 13 <= dt.hour <= 17:
                time_period = 'Afternoon (1PM-5PM)'
        except Exception:
            pass

    feedback_id = f"VOC-{r.get('id', 0):04d}"
    data = [
        feedback_id,
        r.get('user_name', ''),
        r.get('user_email', ''),
        r.get('game_title', ''),
        r.get('machine_name', ''),
        rating,
        r.get('sentiment', ''),
        cat,
        r.get('experience_tag', ''),
        wait,
        1 if (rating <= 2 or wait > 30.0) else 0,
        1 if cat in ('rig_capacity', 'queue_waiting') else 0,
        1 if wait > 30.0 else 0,
        time_period,
        r.get('comment', ''),
        r.get('impact_level', ''),
        r.get('ctq_defect_category', ''),
        created,
    ]
    for col_idx, val in enumerate(data, start=1):
        cell = ws3.cell(row=row_idx, column=col_idx, value=val)
        cell.border = THIN_BORDER
        cell.font = REGULAR_FONT
        if col_idx in (6, 10, 11, 12, 13):
            cell.alignment = Alignment(horizontal='right')

for col in ws3.columns:
    col_letter = get_column_letter(col[0].column)
    ws3.column_dimensions[col_letter].width = 18

ws3.column_dimensions['A'].width = 12
ws3.column_dimensions['B'].width = 16
ws3.column_dimensions['C'].width = 24
ws3.column_dimensions['D'].width = 22
ws3.column_dimensions['O'].width = 70

# Save workbook
output_path = os.path.join(os.getcwd(), 'CloudKH_Lean_Six_Sigma_VOC_Presentation.xlsx')
wb.save(output_path)
print(f'Successfully generated: {output_path}')
