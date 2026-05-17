# Gantt Builder New (Beta) Design Spec

## Skill Routing

Recommended skill: `feature-spec`

Why this fit: the work is a structured product/design spec for a new beta page with user stories, requirements, acceptance criteria, non-goals, and release phasing.

Companion skill: `user-story-mapping`

Why this fit: the new page should be designed around the user journey, not around a flat list of UI widgets.

## Scope

`Gantt Builder New (Beta)` is a separate page that lives next to the current `Gantt Builder`. It should not replace or destabilize the existing builder during beta.

AI features are explicitly out of scope.

The beta page should focus on making project planning faster, denser, and easier to control:

- plan task structure;
- schedule tasks on a timeline;
- assign people and roles;
- see capacity and overload;
- understand dependency and milestone risk;
- save, export, and compare plan states.

## Problem Statement

The current Gantt Builder has useful scheduling logic, GitLab-aware task data, local save, role estimates, per-person capacity, and calendar editing. The main issue is the workflow shape: task editing, calendar planning, workload, filters, and navigation are separated into stacked cards and sub-pages, so planning requires too much scrolling and mode switching.

PMs and leads need a single dense planning surface where task rows, timeline bars, capacity, conflicts, and task details are visible together. Without that, the product is useful for generating a plan but slower for day-to-day planning, scenario changes, and stakeholder review.

## Target Users

### Primary: PM / Delivery Lead

Plans a milestone or sprint across several people, usually from GitLab tasks. Needs to quickly understand what work exists, who owns it, when it happens, and where the plan is unrealistic.

### Secondary: Engineering Lead

Reviews capacity, dependencies, delivery risk, and overloaded people. Needs fast ways to challenge dates and rebalance work.

### Secondary: Individual Contributor

Checks assigned work and planned dates. Needs clarity, not a full planning cockpit.

### Secondary: Stakeholder / Manager

Reviews plan status, milestones, baseline changes, and risk. Needs a readable overview and exports.

## Product Goals

1. Reduce time to create a usable plan from imported/manual tasks.
2. Reduce mode switching by making task grid, timeline, and workload visible in one workspace.
3. Make plan risk visible through overload, dependency, deadline, and baseline indicators.
4. Keep old Gantt Builder stable while beta evolves separately.
5. Preserve current strengths: local planning layer, GitLab metadata, role/person estimates, non-working days, PNG/workspace export.

## Non-Goals

- No AI generation, AI assistant, AI scheduling, or AI task breakdown.
- No real-time multi-user collaboration in beta.
- No full portfolio/program management.
- No replacement of the current Gantt Builder until beta is validated.
- No deep permission model beyond existing local/GitLab behavior.

## Navigation And Entry

Add a separate page:

- nav label: `Gantt Builder New`;
- visible badge: `Beta`;
- route/page id suggestion: `ganttBuilderNew`;
- existing page remains `Gantt Builder`.

Entry points:

- top navigation tab;
- command palette item: `Open Gantt Builder New (Beta)`;
- optional callout inside old Gantt Builder: `Try new beta planner`;
- from Report page: `Open Gantt Builder New`.

Beta page should use its own storage namespace, for example:

- old: `gtr.ganttBuilder:*`;
- new: `gtr.ganttBuilderNew:*`.

Add an import path from old plans, but do not auto-migrate destructively.

## User Story Map

Narrative: as a PM or lead, I want to turn GitLab/manual work into a realistic visual delivery plan so that I can commit dates with confidence and explain delivery risk.

### Activity 1: Start A Planning Session

Steps:

- choose manual or GitLab-based plan;
- select project, period, milestone, or active issue window;
- load or import an existing plan;
- confirm beta page is using a separate local plan.

Release 1 tasks:

- open `Gantt Builder New (Beta)` separately from old builder;
- show current project, period, source, saved/unsaved state;
- import tasks from GitLab using existing source logic;
- import old local Gantt plan into beta plan;
- save beta plan locally without touching old plan.

Release 2 tasks:

- create named plan variants;
- duplicate current plan as scenario;
- show beta feedback/status banner.

### Activity 2: Build The Work Breakdown

Steps:

- create tasks quickly;
- bulk paste tasks;
- edit task fields in a dense grid;
- group tasks by milestone, project, assignee, or status;
- open a task for detailed editing.

Release 1 tasks:

- left task grid with sticky task names;
- inline title, estimate, start, end, assignee, role, status, progress;
- quick add row at bottom/top;
- bulk paste modal;
- task drawer for detailed editing;
- row drag reorder.

Release 2 tasks:

- task groups/collapsible sections;
- custom visible columns;
- bulk edit selected rows;
- duplicate task / split task.

### Activity 3: Schedule And Sequence Work

Steps:

- drag bars on timeline;
- resize duration;
- set milestones and deadlines;
- connect dependencies;
- see conflicts when dates violate rules.

Release 1 tasks:

- unified timeline next to task grid;
- day/week/month zoom;
- today marker;
- weekend and non-working day display;
- drag to move and resize bars;
- keyboard accessible date edits in grid/drawer.

Release 2 tasks:

- milestones as diamond markers;
- deadlines as vertical markers/icons;
- finish-to-start dependencies;
- dependency conflict warnings;
- auto-shift dependent tasks when user confirms.

Release 3 tasks:

- more dependency types: start-to-start, finish-to-finish;
- lag/lead;
- critical path.

### Activity 4: Balance People And Capacity

Steps:

- assign people and roles;
- adjust estimates per person;
- compare load with weekly capacity;
- resolve overloads;
- filter by person/role.

Release 1 tasks:

- bottom workload heatmap by person/week;
- overload badges on rows and people;
- capacity summary in person lane or drawer;
- person/role filters;
- quick jump to overloaded week.

Release 2 tasks:

- drag work from one person to another;
- bulk reassignment;
- per-person availability calendar;
- configurable working schedule beyond simple weekly hours.

### Activity 5: Review, Compare, And Share

Steps:

- inspect warnings;
- compare current plan with baseline;
- export a stakeholder-friendly view;
- push selected dates back to GitLab when connected;
- preserve local work.

Release 1 tasks:

- conflict center panel;
- PNG export for current view;
- workspace export/import includes beta plans;
- GitLab reality checks reused from current builder;
- explicit local-only save state.

Release 2 tasks:

- baseline snapshot;
- baseline bars under current bars;
- variance summary: slipped, pulled in, unchanged;
- export beta view with visible filters.

Release 3 tasks:

- changelog/history of local plan edits;
- shareable read-only JSON/HTML snapshot.

## Main Page Design

### Desktop Layout

Use a dense operational workspace, not stacked marketing cards.

```
Header
  Project / period / source / beta badge / save state / primary actions

Toolbar
  Plan source | View mode | Zoom | Group by | Filters | Display settings | Export

Workspace
  Left: Task Grid                 Right: Timeline
  - sticky task names             - bars aligned to rows
  - editable columns              - today marker
  - row selection                 - milestones/deadlines
  - hierarchy/grouping            - dependency lines

Bottom Panel
  Workload heatmap / Conflict center / Baseline variance

Right Drawer
  Task details / People / Dependencies / GitLab facts
```

Recommended default split:

- task grid width: 360-460px;
- timeline fills remaining width;
- right drawer width: 420px when open;
- bottom panel height: 220-320px, resizable/collapsible.

### Mobile / Narrow Layout

Beta can be optimized for desktop first. On narrow screens:

- show task list first;
- timeline becomes horizontally scrollable;
- drawer becomes full-screen sheet;
- workload moves to a tab;
- dependency editing can be read-only or simplified.

## Visual Direction

### Style

Use a restrained SaaS planning surface:

- neutral background: slate/white;
- compact spacing;
- clear gridlines;
- sticky headers;
- limited accent colors;
- no large decorative cards;
- no nested cards inside cards;
- color communicates state, not decoration.

### Color Semantics

- blue: selected/focused planning element;
- green: healthy capacity or completed status;
- yellow/amber: warning, approaching capacity, due soon;
- red/rose: overload, invalid dependency, overdue;
- purple/cyan: avoid as dominant page theme; use only as optional role colors;
- gray/slate: normal structure, inactive controls, separators.

### Typography

- page title: compact, 16-18px;
- toolbar labels: 11-12px;
- grid cells: 12-13px;
- timeline bar labels: 10-12px;
- no viewport-based font scaling;
- keep letter spacing at 0 except tiny uppercase labels already used in the app.

### Icons

Use `lucide-react` consistently:

- `CalendarRange` for timeline;
- `Rows3` or `Table2` for grid;
- `Users` for workload;
- `GitBranch` for dependencies;
- `Diamond` or `Milestone` equivalent for milestones;
- `Flag` for deadlines;
- `Baseline`, if unavailable, use `PanelBottom`/`Layers`;
- `AlertTriangle` for conflicts;
- `SlidersHorizontal` for view settings;
- `Save`, `Upload`, `Download`, `RefreshCw` for actions.

## Core Feature Designs

### 1. Unified Grid + Timeline Workspace

User story:

As a PM, I want task fields and timeline bars visible together so that I can edit the plan without switching pages.

Design:

- left grid and right timeline share row heights;
- task rows are selectable;
- selected row highlights both grid row and timeline bar;
- row header stays sticky during horizontal scroll;
- timeline date header stays sticky during vertical scroll;
- row hover reveals quick actions: edit, duplicate, delete, add dependency.

Acceptance criteria:

- editing task dates in grid moves the timeline bar;
- dragging timeline bar updates grid dates;
- resizing bar updates end date/duration/estimate according to selected scheduling mode;
- scroll keeps task row and timeline row aligned;
- old Gantt Builder remains unchanged.

### 2. Task Grid

User story:

As a delivery lead, I want to edit important task fields inline so that I can shape a plan quickly.

Default columns:

- drag handle;
- task title;
- status;
- progress;
- start;
- end;
- estimate;
- assignee;
- role;
- milestone;
- warnings;
- GitLab ref.

Design:

- compact row height: 36-44px;
- long titles truncate with tooltip;
- invalid fields show inline red border and warning icon;
- column visibility controlled from `View settings`;
- grid supports multi-select checkboxes in beta release 2.

Acceptance criteria:

- user can add a task row without leaving the grid;
- user can edit title, status, dates, estimate, assignee, role;
- GitLab-linked tasks show project/IID and open link;
- columns can be hidden/shown without data loss.

### 3. Timeline

User story:

As a PM, I want to move and resize task bars directly on the schedule so that I can test dates quickly.

Design:

- task bars aligned to grid rows;
- today marker as vertical blue line;
- weekends/non-working days shaded;
- active drag shows ghost position;
- invalid placement shows red outline and tooltip;
- tiny bars use icon/abbr label, not overflowing text.

Zoom modes:

- Day: detailed planning, existing behavior;
- Week: default for 1-3 month plans;
- Month: stakeholder overview.

Acceptance criteria:

- user can switch zoom without losing selected row;
- today marker remains visible if today is inside range;
- drag/resize operations preserve working-day rules;
- non-working days cannot silently absorb work hours.

### 4. Task Drawer

User story:

As a PM, I want a detail panel for a task so that complex edits do not clutter the grid.

Tabs:

- Details;
- Assignments;
- Dependencies;
- GitLab;
- History/Baseline, release 2+.

Details fields:

- title;
- description/notes;
- status;
- progress;
- start/end;
- estimate;
- milestone;
- deadline;
- labels.

Assignments fields:

- role estimates;
- people;
- person-specific estimate;
- person-specific start date;
- capacity impact preview.

Acceptance criteria:

- opening drawer does not navigate away;
- drawer can be closed with Escape;
- unsaved local edits are reflected immediately in grid/timeline;
- GitLab facts are read-only unless user explicitly pushes supported fields.

### 5. Workload Heatmap

User story:

As an engineering lead, I want to see overloaded people by week so that I can rebalance the plan before committing.

Design:

- bottom panel tab: `Workload`;
- rows: people;
- columns: weeks;
- cell shows planned/capacity hours;
- color scale: green under 80%, amber 80-100%, red over 100%;
- click cell filters timeline to person/week;
- hovering lists tasks contributing to load.

Acceptance criteria:

- workload uses the same schedule calculation as timeline bars;
- overload count in header matches heatmap red cells;
- filtering by overloaded cell does not modify saved plan;
- unassigned work is visible as its own row.

### 6. Conflict Center

User story:

As a PM, I want all plan problems in one place so that I can fix the highest-risk issues first.

Conflict types:

- overloaded person/week;
- task outside selected period;
- open GitLab task planned in the past;
- closed GitLab task planned in the future;
- local assignees differ from GitLab;
- missing estimate;
- spent time above estimate;
- dependency violation, release 2;
- missed deadline, release 2;
- baseline slip, release 2.

Design:

- bottom panel tab: `Conflicts`;
- grouped by severity: Blocking, Warning, Info;
- each item has action: jump to task, open drawer, copy summary;
- conflicts are visible but do not block local planning unless technically impossible.

Acceptance criteria:

- clicking conflict selects task and scrolls it into view;
- warnings can be copied/exported;
- conflict list updates after edits;
- resolved conflicts disappear without page reload.

### 7. Milestones And Deadlines

User story:

As a PM, I want milestones and deadlines visible on the timeline so that the plan communicates key commitments.

Design:

- milestone: diamond marker on timeline, can be attached to date or task group;
- deadline: flag/vertical marker on task row;
- overdue deadline: red marker and conflict item;
- milestone row can appear as a group header when grouping by milestone.

Acceptance criteria:

- user can create milestone from toolbar or task drawer;
- user can assign task to milestone;
- user can set task deadline separately from end date;
- milestone and deadline are included in PNG/workspace export.

### 8. Dependencies

User story:

As a lead, I want to connect dependent tasks so that schedule changes reveal sequencing risk.

Release 2 design:

- start with finish-to-start only;
- user creates dependency by dragging connector from one bar to another or from drawer;
- dependency lines are subtle gray, selected line is blue;
- violation shows red line and conflict item;
- when moving predecessor, app asks whether to shift successors.

Acceptance criteria:

- user can create and delete dependency;
- app prevents self-dependency;
- app prevents circular dependency;
- violating dependency is visible in timeline and conflict center;
- auto-shift only runs after explicit confirmation.

### 9. Baseline

User story:

As a PM, I want to compare the current plan against an approved baseline so that I can explain schedule changes.

Design:

- action: `Set baseline`;
- baseline bar: thin, muted bar behind current bar;
- variance badges: `+3d`, `-1d`, `same`;
- bottom panel tab: `Baseline`;
- summary: slipped tasks, pulled-in tasks, unchanged tasks.

Acceptance criteria:

- user can create one active baseline snapshot;
- user can reset baseline after confirmation;
- timeline shows baseline only when display toggle is on;
- baseline data is stored with beta plan and exported in workspace.

### 10. View Settings And Presets

User story:

As a PM, I want to change what the plan shows so that I can use the same data for planning and stakeholder review.

Settings:

- zoom: day/week/month;
- group by: none, milestone, assignee, project, status;
- show/hide weekends;
- show/hide non-working days;
- show/hide dependencies;
- show/hide baseline;
- show/hide GitLab refs;
- show/hide workload;
- visible columns.

Presets:

- Planning;
- Capacity review;
- Stakeholder summary;
- GitLab reality check.

Acceptance criteria:

- view settings do not mutate task data;
- current view settings persist locally;
- preset switch is immediate;
- export uses the current visible view.

## Release Slices

### Release 1: Beta Foundation

Goal: ship a separate beta planner that is already easier to use than the current builder for normal planning.

Must include:

- separate nav/page/storage;
- import current plan shape into beta;
- unified task grid + timeline;
- task drawer;
- day/week/month zoom;
- today marker;
- sticky headers and sticky task column;
- workload heatmap;
- conflict center with current warning types;
- PNG/workspace export support;
- no changes to old builder behavior.

### Release 2: Planning Control

Goal: make the plan more PM-grade by adding control points and sequencing.

Should include:

- milestones;
- deadlines;
- finish-to-start dependencies;
- dependency warnings;
- baseline snapshot;
- baseline variance panel;
- bulk edit;
- group by milestone/status/assignee;
- view presets.

### Release 3: Advanced Scheduling

Goal: support more complex plans once beta foundation is validated.

Could include:

- dependency types beyond finish-to-start;
- lag/lead;
- critical path;
- plan variants/scenarios;
- edit history;
- richer import/export formats;
- read-only share snapshot.

## P0 Requirements

1. The beta page is separate from the existing builder and uses separate local storage.
2. The main beta workspace shows task grid and timeline in one aligned surface.
3. Task edits in grid, drawer, and timeline stay synchronized.
4. Workload heatmap uses the same scheduling data as the timeline.
5. Existing GitLab reality checks are represented in the conflict center.
6. The user can export/import workspace data without losing beta plans.
7. The old Gantt Builder remains available and unchanged.

## P1 Requirements

1. Milestones and deadlines.
2. Finish-to-start dependencies.
3. Baseline snapshot and variance display.
4. Bulk edit selected tasks.
5. View settings and saved presets.
6. Grouping by milestone, assignee, project, or status.

## P2 Requirements

1. Critical path.
2. Multiple plan variants.
3. Advanced dependency types and lag/lead.
4. Edit history.
5. Read-only stakeholder snapshot.
6. XLSX/CSV export for beta task grid.

## Key Visual States

### Empty State

Show one compact startup panel:

- `Create manual plan`;
- `Load from GitLab`;
- `Import old Gantt plan`;
- `Bulk paste tasks`.

Do not show a long empty dashboard before first task/person exists.

### Loading State

- skeleton rows in grid;
- skeleton timeline bars;
- small status text: loading GitLab milestones/issues;
- keep toolbar visible.

### Unsaved State

- header badge: `Unsaved changes`;
- save button enabled;
- before leaving page, confirm if unsaved local changes exist.

### Conflict State

- header warning count;
- row warning icons;
- bottom conflict center;
- no blocking modal for non-critical warnings.

### Read-Only / GitLab Fact State

- GitLab facts are visually distinct from editable local plan fields;
- facts use muted chips/labels;
- pushing dates to GitLab is explicit and confirmable.

## Measurement

Leading metrics:

- time from opening beta page to first planned task;
- time to create/import 20 tasks and assign people;
- number of mode switches per planning session;
- percentage of sessions using workload heatmap;
- percentage of sessions resolving at least one conflict.

Quality metrics:

- failed export/import rate;
- drag/resize error rate;
- number of unsaved-change loss reports;
- beta page performance with 100, 300, and 1000 tasks.

Qualitative checks:

- PM can explain plan risk from one screen;
- engineering lead can identify overload without reading every task;
- stakeholder export is understandable without app context.

## Implementation Notes

Keep beta implementation isolated:

- new component: `GanttBuilderNewView`;
- new page id: `ganttBuilderNew`;
- new lib module if data model diverges: `ganttBuilderNew.ts`;
- avoid changing current `GanttBuilderView` except optional link to beta;
- reuse scheduling utilities only where behavior is intentionally shared;
- make data migration explicit and reversible.

Recommended first technical milestone:

1. Add route/nav/page shell.
2. Render imported/current plan in grid + timeline read-only.
3. Add synchronized edit path for dates/estimate/assignee.
4. Add workload heatmap and conflict center.
5. Add export/import coverage for beta storage.

## Open Questions

- Should beta plans support multiple named scenarios in release 1 or release 2?
- Should task duration be stored explicitly, or derived from estimate and capacity as today?
- Should status/progress sync back to GitLab later, or remain local-only?
- Should dependencies be local-only, or encoded into GitLab links where possible?
- What is the practical maximum task count target for beta performance?
