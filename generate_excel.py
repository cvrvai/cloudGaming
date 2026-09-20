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
SUBHEADER_FILL = PatternFill(start_color='2C3E50', end_color='2C3E50', fill_type='solid')
CYAN_FILL = PatternFill(start_color='E0F2FE', end_color='E0F2FE', fill_type='solid')
ALERT_FILL = PatternFill(start_color='FEE2E2', end_color='FEE2E2', fill_type='solid')
AMBER_FILL = PatternFill(start_color='FEF3C7', end_color='FEF3C7', fill_type='solid')
GREEN_FILL = PatternFill(start_color='DCFCE7', end_color='DCFCE7', fill_type='solid')
PURPLE_FILL = PatternFill(start_color='F3E8FF', end_color='F3E8FF', fill_type='solid')

WHITE_BOLD = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
TITLE_FONT = Font(name='Calibri', size=15, bold=True, color='FFFFFF')
SECTION_FONT = Font(name='Calibri', size=13, bold=True, color='1B263B')
REGULAR_FONT = Font(name='Calibri', size=11)
BOLD_FONT = Font(name='Calibri', size=11, bold=True)
ALERT_FONT = Font(name='Calibri', size=11, bold=True, color='991B1B')
GREEN_FONT = Font(name='Calibri', size=11, bold=True, color='166534')

THIN_BORDER = Border(
    left=Side(style='thin', color='CBD5E1'),
    right=Side(style='thin', color='CBD5E1'),
    top=Side(style='thin', color='CBD5E1'),
    bottom=Side(style='thin', color='CBD5E1')
)

# -------------------------------------------------------------------------
# SHEET 1: EXECUTIVE SUMMARY & PROJECT CHARTER
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

ws1['A4'] = '1. PROJECT PROBLEM STATEMENT & DMAIC DEFINE PHASE OBJECTIVE'
ws1['A4'].font = SECTION_FONT

ws1.merge_cells('A5:G6')
ws1['A5'] = (
    "Problem Statement: During the pilot trial of the CloudKH university gaming platform across 14 student players, "
    "an overwhelming 78.6% of user feedback cited unacceptable queue wait times (mean = 66.1 minutes) and cross-game blocking "
    "caused by having only 1 physical gaming host rig online. Overall customer satisfaction (CSAT) fell to 1.8 / 5.0 stars. "
    "This week's presentation transitions the Voice of the Customer (VOC) into 4 measurable Critical-to-Quality (CTQ) engineering specifications "
    "to be addressed through multi-node scaling and session optimization."
)
ws1['A5'].font = REGULAR_FONT
ws1['A5'].fill = CYAN_FILL
ws1['A5'].alignment = Alignment(vertical='center', wrap_text=True)

ws1['A8'] = '2. PROJECT BASELINE METRICS VS. SIX SIGMA TARGET SPECIFICATIONS'
ws1['A8'].font = SECTION_FONT

kpis = [
    ('Metric Description', 'Target / Specification', 'Observed Baseline Value', 'Defect Status', 'DMAIC CTQ Owner'),
    ('Overall Player Satisfaction (CSAT)', '≥ 3.5 / 5.0 Stars', '1.8 / 5.0 Stars', 'CRITICAL DEFECT', 'Team Wide'),
    ('Mean Queue Waiting Time', '≤ 30.0 Minutes', '66.1 Minutes (Max: 110m)', 'SEVERE DEFECT', 'Lim Hokann (CTQ 3)'),
    ('Single-PC Hardware Bottleneck Complaints', '< 10.0% of Complaints', '78.6% (11 / 14 Records)', 'PRIMARY ROOT CAUSE', 'Lim Hokann (CTQ 3)'),
    ('Active Fleet Hardware Concurrency', '≥ 2 Concurrent Players', '1 Player Monopolizing GPU', 'CAPACITY CONSTRAINT', 'Choonvai (CTQ 2)'),
    ('Stream Latency (Off-Peak vs Busy)', '≤ 100 ms', '45ms Off-Peak / 70ms Busy', 'PASS (Technology Valid)', 'Sean Pheavy (CTQ 1)'),
    ('Session Completion Rate', '≥ 95.0%', '92.9% (Mid-Game Cutoffs Cited)', 'BORDERLINE DEFECT', 'Hour (CTQ 4)'),
]

for row_idx, row_data in enumerate(kpis, start=9):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws1.cell(row=row_idx, column=col_idx, value=val)
        cell.border = THIN_BORDER
        if row_idx == 9:
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

ws1['A18'] = '3. TEAM MEMBER PRESENTATION ALLOCATION & CTQ RESPONSIBILITIES'
ws1['A18'].font = SECTION_FONT

team_roles = [
    ('Member Name', 'University Email', 'DMAIC Project Role', 'Assigned CTQ Focus', 'Key Presentation Focus to Teacher'),
    ('Choonvai ជុង ចូនវ៉ៃ', 'cheong.choonvai24@kit.edu.kh', 'Project Champion & Fleet Architect', 'CTQ 2: Rig Utilization & Energy Efficiency', 'Fleet architecture, 24/7 self-healing daemon, idle vs active energy efficiency, and operational plan to deploy Node #2 Choonvai.'),
    ('Lim Hokann', 'lim.hokan24@kit.edu.kh', 'Voice of Customer (VOC) Lead', 'CTQ 3: Rig Capacity & Queue Waiting Time', 'Analysis of 14 student gamer complaints, Pareto 80/20 root cause (78.6% single-PC bottleneck), cross-game blocking, and queue starvation metrics.'),
    ('Sean Pheavyraksonya', 'sean.pheavy@kit.edu.kh', 'Stream Quality & Hardware Lead', 'CTQ 1: Stream Latency & Thermal Performance', 'WebRTC low latency pipeline (45-70ms), GPU junction temperature under continuous 6-hour load, and hardware load balancing across multi-PC fleet.'),
    ('Hour', 'hour0407@gmail.com', 'Operations & Booking Lead', 'CTQ 4: Session Completion & Booking Allocation', 'Session completion rate (92.9%), dynamic booking slot handovers, and resolving 30-min hard session cutoffs that frustrate players.'),
]

for row_idx, row_data in enumerate(team_roles, start=19):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws1.cell(row=row_idx, column=col_idx, value=val)
        cell.border = THIN_BORDER
        if row_idx == 19:
            cell.font = WHITE_BOLD
            cell.fill = HEADER_FILL
            cell.alignment = Alignment(horizontal='center', vertical='center')
        else:
            cell.font = REGULAR_FONT
            cell.alignment = Alignment(vertical='top')

for col in ws1.columns:
    max_len = max(len(str(cell.value or '')) for cell in col)
    col_letter = get_column_letter(col[0].column)
    ws1.column_dimensions[col_letter].width = min(max(max_len + 3, 14), 50)

# -------------------------------------------------------------------------
# SHEET 2: VOC TO CTQ TRANSLATION MATRIX (FLOWDOWN TREE)
# -------------------------------------------------------------------------
ws2 = wb.create_sheet(title='VOC_to_CTQ_Flowdown')
ws2.views.sheetView[0].showGridLines = True

ws2.merge_cells('A1:H1')
ws2['A1'] = 'Voice of Customer (VOC) to Critical-to-Quality (CTQ) Translation Matrix'
ws2['A1'].font = TITLE_FONT
ws2['A1'].fill = NAVY_FILL
ws2['A1'].alignment = Alignment(horizontal='center', vertical='center')
ws2.row_dimensions[1].height = 38

ws2.merge_cells('A2:H2')
ws2['A2'] = 'Academic Lean Six Sigma Flowdown: Showing how qualitative student gamer feedback translates into measurable engineering specifications.'
ws2['A2'].font = Font(name='Calibri', size=10, italic=True, color='FFFFFF')
ws2['A2'].fill = SUBHEADER_FILL
ws2['A2'].alignment = Alignment(horizontal='center', vertical='center')
ws2.row_dimensions[2].height = 22

flowdown_headers = [
    'ID', 'Student / Stakeholder', 'Verbatim Voice of Customer (VOC Quote)', 
    'Key Customer Issue / Unmet Need', 'Critical-to-Quality (CTQ) Category', 
    'Operational Definition & Engineering Metric', 'Specification Limit / Target', 'CTQ Owner'
]

for col_idx, h in enumerate(flowdown_headers, start=1):
    c = ws2.cell(row=4, column=col_idx, value=h)
    c.font = WHITE_BOLD
    c.fill = HEADER_FILL
    c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    c.border = THIN_BORDER
ws2.row_dimensions[4].height = 28

flowdown_rows = [
    (
        'VOC-01', 'That is Me',
        '"Bro I wanted to chill with Stardew Valley after class, but someone was playing Hades II and locked the only PC for 75 mins..."',
        'Cross-game blocking: 1 player monopolizes the entire physical host, preventing others from playing unrelated games.',
        'CTQ 3: Rig Capacity & Waiting Time',
        'Queue Waiting Time (min) & Available Concurrency',
        'Target: ≤ 15 min; USL: 30 min; Concurrency ≥ 2',
        'Lim Hokann'
    ),
    (
        'VOC-02', 'Lihour',
        '"Waited 90 mins in line... My instant noodles got cold waiting for the rig to be free."',
        'Disproportionate waiting time: User spends 90 minutes waiting for a 30-minute play session.',
        'CTQ 3: Rig Capacity & Waiting Time',
        'Queue Waiting Time (min) & Play-to-Wait Ratio',
        'Target: ≤ 15 min; USL: 30 min; Ratio ≥ 2.0x',
        'Lim Hokann'
    ),
    (
        'VOC-03', 'Hokann',
        '"Tried to jump into Brotato at 8 PM. Queue was 85 minutes long... Why advertise cloud gaming if we have to wait like a government office?"',
        'Peak evening queue congestion destroys platform credibility for quick casual gaming.',
        'CTQ 3: Rig Capacity & Waiting Time',
        'Peak Queue Waiting Time (min)',
        'Target: ≤ 15 min; USL: 30 min',
        'Lim Hokann'
    ),
    (
        'VOC-04', 'Neakleng',
        '"110 mins wait time?? That is literally two whole university lecture periods... I gave up and went to sleep."',
        'Extreme delay leads directly to customer abandonment and negative word-of-mouth.',
        'CTQ 3: Rig Capacity & Waiting Time',
        'Customer Queue Abandonment Rate (%)',
        'Target: < 5.0%; USL: 10.0%',
        'Lim Hokann'
    ),
    (
        'VOC-05', 'Bokpa',
        '"Platform is cool but 1 PC for the whole campus is wild... Choonvai said he had an RTX laptop, why is it not in the fleet?"',
        'Under-utilized available hardware; student community expects known hardware resources to be mobilized.',
        'CTQ 2: Rig Utilization & Fleet Concurrency',
        'Active Fleet Node Count (Online Physical PCs)',
        'Target: ≥ 2 Rigs Online; LSL: 2 Rigs',
        'Choonvai'
    ),
    (
        'VOC-06', 'Chylong',
        '"Waited 50 mins, got 30 mins playtime. I spend more time looking at the waiting screen than actually playing..."',
        'Inverted session ratio: Wait time exceeds session playtime by 1.67x.',
        'CTQ 3: Rig Capacity & Waiting Time',
        'Play-to-Wait Time Ratio (Play Mins / Wait Mins)',
        'Target: ≥ 2.0x; LSL: 1.0x',
        'Lim Hokann'
    ),
    (
        'VOC-07', 'ម៉េន បញ្ញាវឌ្ឍន៍',
        '"Bro 1 rig means only 1 person in the entire universe can play CloudKH at any second..."',
        'Zero architectural concurrency: System behaves as a single-user kiosk rather than a cloud service.',
        'CTQ 3: Rig Capacity & Waiting Time',
        'Concurrent Player Capacity (Simultaneous Streams)',
        'Target: ≥ 2 Players; LSL: 2 Players',
        'Lim Hokann'
    ),
    (
        'VOC-08', 'Ann',
        '"The stream was smooth when I played, but after 40 mins the rig got super hot and video started dropping frames..."',
        'Thermal fatigue and frame drop under prolonged continuous 100% GPU utilization without load-balancing.',
        'CTQ 1: Stream Latency & Thermal Performance',
        'Host GPU Temperature (°C) & Frame Drop Rate (%)',
        'Target: ≤ 72°C; USL: 78°C; Drops < 1.0%',
        'Sean Pheavy'
    ),
    (
        'VOC-09', 'Test',
        '"System works, but leaving the PC powered on 24/7 when nobody plays at 3 AM is burning electricity for nothing..."',
        'Inefficient power consumption: Constant idle draw off-peak vs severe congestion during peak.',
        'CTQ 2: Rig Utilization & Energy Efficiency',
        'Host Idle Power Draw (Watts) & Fleet Power Cost',
        'Target: < 15W Idle; Target: > 70% Peak Utilization',
        'Choonvai'
    ),
    (
        'VOC-10', 'meng',
        '"I was 1 hit away from beating Chronos in Hades and the system abruptly kicked me out because my 30 mins was up..."',
        'Abrupt session cutoff with zero grace period or boss-fight extension warning.',
        'CTQ 4: Session Completion & Booking Allocation',
        'Session Completion Rate (%) & Handover Warning',
        'Target: ≥ 95.0%; Warning at T-5m & T-1m',
        'Hour'
    ),
    (
        'VOC-11', 'Ney Mar',
        '"Waited 80 mins for my turn. Right when I loaded in, my dorm warden came and told me lights out. Wasted my whole evening..."',
        'Dorm curfew conflict caused by unpredictable and excessive queue wait times.',
        'CTQ 3: Rig Capacity & Waiting Time',
        'Queue Time Predictability & Maximum Wait Duration',
        'Target: ≤ 15 min wait; USL: 30 min',
        'Lim Hokann'
    ),
    (
        'VOC-12', 'Choonvai',
        '"Ratio is completely cooked: 55 mins waiting for 30 mins playtime. If you guys hook up Node #2 (Choonvai\'s RTX rig) we wouldn\'t all be starving in line..."',
        'Technical root cause confirmed: Deploying secondary physical node will directly double player capacity.',
        'CTQ 2: Rig Utilization & Fleet Concurrency',
        'Fleet Node Concurrency (Active Registered Nodes)',
        'Target: 2 Active Nodes (Node #2 + Node #3)',
        'Choonvai'
    ),
    (
        'VOC-13', 'Cvr Kh',
        '"Bro advertise 4 games but when you click play it says someone else is using the machine. What is this, a public bathroom with 1 stall? 💀"',
        'Customer perception of extreme artificial scarcity: High game catalog variety locked behind a single access point.',
        'CTQ 3: Rig Capacity & Waiting Time',
        'Queue Waiting Time (min) & Concurrency',
        'Target: ≤ 15 min; Concurrency ≥ 2',
        'Lim Hokann'
    ),
    (
        'VOC-14', 'choonvai',
        '"Played at 6:30 AM when everyone was sleeping. Zero wait time and 60 FPS smooth with sub-45ms latency. The streaming tech is actually clean, the only curse is having only 1 PC when people wake up."',
        'Control Baseline: Validates WebRTC low-latency streaming pipeline is robust when rig is uncontested.',
        'CTQ 1: Stream Latency & Technology Verification',
        'Round-trip WebRTC Latency (ms) & Framerate (FPS)',
        'Target: Latency ≤ 50ms; Framerate = 60 FPS',
        'Sean Pheavy'
    ),
]

for row_idx, r in enumerate(flowdown_rows, start=5):
    for col_idx, val in enumerate(r, start=1):
        cell = ws2.cell(row=row_idx, column=col_idx, value=val)
        cell.border = THIN_BORDER
        cell.font = REGULAR_FONT
        if col_idx in (1, 8):
            cell.alignment = Alignment(horizontal='center', vertical='top')
        elif col_idx in (5, 7):
            cell.alignment = Alignment(vertical='top')
            if 'CTQ 3' in str(val):
                cell.fill = ALERT_FILL
            elif 'CTQ 2' in str(val):
                cell.fill = CYAN_FILL
            elif 'CTQ 1' in str(val):
                cell.fill = GREEN_FILL
            elif 'CTQ 4' in str(val):
                cell.fill = PURPLE_FILL
        else:
            cell.alignment = Alignment(vertical='top', wrap_text=True)
    ws2.row_dimensions[row_idx].height = 42

ws2.column_dimensions['A'].width = 11
ws2.column_dimensions['B'].width = 16
ws2.column_dimensions['C'].width = 46
ws2.column_dimensions['D'].width = 38
ws2.column_dimensions['E'].width = 28
ws2.column_dimensions['F'].width = 32
ws2.column_dimensions['G'].width = 28
ws2.column_dimensions['H'].width = 18

# -------------------------------------------------------------------------
# SHEET 3: PARETO ANALYSIS (80/20 DEFECT RULE)
# -------------------------------------------------------------------------
ws3 = wb.create_sheet(title='Pareto_Analysis')
ws3.views.sheetView[0].showGridLines = True

ws3.merge_cells('A1:F1')
ws3['A1'] = 'Voice of Customer Defect Breakdown - Pareto 80/20 Analysis (N = 14)'
ws3['A1'].font = TITLE_FONT
ws3['A1'].fill = NAVY_FILL
ws3['A1'].alignment = Alignment(horizontal='center', vertical='center')
ws3.row_dimensions[1].height = 36

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
        cell = ws3.cell(row=row_idx, column=col_idx, value=val)
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

ws3['A10'] = 'Key Academic Insight for Teacher:'
ws3['A10'].font = BOLD_FONT
ws3.merge_cells('A11:F11')
ws3['A11'] = '78.6% of all customer dissatisfaction stems from having only 1 physical gaming PC online. Adding Node #2 (Gaming PC Choonvai) directly eliminates ~80% of customer defects.'
ws3['A11'].font = ALERT_FONT
ws3['A11'].fill = ALERT_FILL

for col in ws3.columns:
    max_len = max(len(str(cell.value or '')) for cell in col)
    col_letter = get_column_letter(col[0].column)
    ws3.column_dimensions[col_letter].width = min(max(max_len + 3, 14), 50)

# -------------------------------------------------------------------------
# SHEET 4: RAW VOC DATASET (VERBATIM RECORDS)
# -------------------------------------------------------------------------
ws4 = wb.create_sheet(title='VOC_Feedback_Dataset')
ws4.views.sheetView[0].showGridLines = True

headers = [
    'Feedback ID', 'Player Name', 'Email', 'Game Title', 'Host Rig',
    'Rating', 'Sentiment', 'Category', 'Experience Tag', 'Wait Time (min)',
    'CTQ Defect (1/0)', 'Capacity Defect (1/0)', 'Wait > 30m', 'Time Period',
    'Verbatim Customer Complaint / Voice of Customer', 'Impact', 'CTQ Classification', 'Timestamp'
]

for col_idx, h in enumerate(headers, start=1):
    cell = ws4.cell(row=1, column=col_idx, value=h)
    cell.font = WHITE_BOLD
    cell.fill = HEADER_FILL
    cell.alignment = Alignment(horizontal='center', vertical='center')
    cell.border = THIN_BORDER
ws4.row_dimensions[1].height = 26

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
        cell = ws4.cell(row=row_idx, column=col_idx, value=val)
        cell.border = THIN_BORDER
        cell.font = REGULAR_FONT
        if col_idx in (6, 10, 11, 12, 13):
            cell.alignment = Alignment(horizontal='right')

for col in ws4.columns:
    col_letter = get_column_letter(col[0].column)
    ws4.column_dimensions[col_letter].width = 18

ws4.column_dimensions['A'].width = 12
ws4.column_dimensions['B'].width = 16
ws4.column_dimensions['C'].width = 24
ws4.column_dimensions['D'].width = 22
ws4.column_dimensions['O'].width = 70

# Save workbook
output_path = os.path.join(os.getcwd(), 'CloudKH_Lean_Six_Sigma_VOC_Presentation.xlsx')
wb.save(output_path)
print(f'Successfully generated 4-sheet workbook: {output_path}')
