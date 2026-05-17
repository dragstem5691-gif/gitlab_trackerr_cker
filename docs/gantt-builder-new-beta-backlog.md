# Gantt Builder New (Beta) Development Backlog

Source spec: `docs/gantt-builder-new-beta-design.md`

AI features are out of scope.

## Backlog Strategy

Use vertical slices. Each story should deliver visible behavior to a PM, engineering lead, contributor, or stakeholder. Avoid splitting into "UI only", "data model only", or "API only" stories unless it is a time-boxed spike or an enabling engineering task attached to a user-facing story.

Primary release strategy:

- Release 1: Beta Foundation - separate page, isolated storage, unified grid/timeline, drawer, workload, conflicts, export/import.
- Release 2: Planning Control - milestones, deadlines, finish-to-start dependencies, baseline, bulk edit, grouping, view presets.
- Release 3: Advanced Scheduling - advanced dependencies, critical path, scenarios, history, richer sharing/export.

## Release 1: Beta Foundation

Goal: ship a separate beta planner that is already easier than the current builder for normal planning.

### Epic GBN-01: Beta Page Shell And Isolation

Problem:

Users need to try the new planning surface without risking the current `Gantt Builder` workflow or its saved data.

Split pattern:

- Workflow steps: enter beta, see page shell, save isolated data, return to old builder.

#### Story GBN-01.1: Open Separate Beta Page

Use case:

- As a PM
- I want to open `Gantt Builder New (Beta)` separately from the current builder
- so that I can try the new planner without disrupting my existing workflow.

Acceptance criteria:

- Given the app is loaded
- When I use the top navigation or command palette to open `Gantt Builder New`
- Then I see a dedicated beta page with a visible `Beta` badge.

- Given the current `Gantt Builder` still exists
- When I navigate between the old and new builders
- Then each page keeps its own UI state and neither page is removed.

Notes:

- Suggested page id: `ganttBuilderNew`.
- Suggested component: `GanttBuilderNewView`.

#### Story GBN-01.2: Use Separate Beta Storage

Use case:

- As a PM
- I want beta plans stored separately from old Gantt plans
- so that beta experiments cannot corrupt my current saved plans.

Acceptance criteria:

- Given I create or edit a beta plan
- When the plan is saved locally
- Then it is stored under a `gtr.ganttBuilderNew:*` namespace.

- Given an old builder plan exists
- When I save a beta plan
- Then the old `gtr.ganttBuilder:*` entries remain unchanged.

#### Story GBN-01.3: Show Beta Plan Header

Use case:

- As a delivery lead
- I want the beta page header to show project, period, source, and save state
- so that I always know what plan I am editing.

Acceptance criteria:

- Given a beta plan is open
- When I look at the header
- Then I see project path, selected period, plan source, `Beta` badge, and saved/unsaved state.

- Given local changes exist
- When I look at the header
- Then the save state changes to `Unsaved changes`.

#### Story GBN-01.4: Guard Against Unsaved Navigation

Use case:

- As a PM
- I want a warning before leaving with unsaved beta changes
- so that I do not lose planning work by accident.

Acceptance criteria:

- Given the beta plan has unsaved changes
- When I navigate away, reload, or switch to another page
- Then I am asked to confirm leaving.

- Given I save the plan
- When I navigate away
- Then no unsaved-change warning is shown.

### Epic GBN-02: Plan Import And Compatibility

Problem:

The beta page must start from existing data rather than forcing users to recreate plans.

Split pattern:

- Data variations: old local plan, GitLab report context, manual empty plan.

#### Story GBN-02.1: Start From Empty Manual Plan

Use case:

- As a PM
- I want to create an empty beta plan manually
- so that I can plan work even without GitLab data.

Acceptance criteria:

- Given no report is loaded
- When I open beta and choose `Create manual plan`
- Then a standalone beta plan is created with the default period and no tasks.

- Given the empty plan has no people or tasks
- When I view the page
- Then I see compact startup actions, not a long empty dashboard.

#### Story GBN-02.2: Import Current Old Gantt Plan Into Beta

Use case:

- As a PM
- I want to copy my existing old Gantt Builder plan into beta
- so that I can continue planning in the new workspace without manual re-entry.

Acceptance criteria:

- Given an old local Gantt plan exists for the same project and period
- When I choose `Import old Gantt plan`
- Then beta creates a separate copy of people, tasks, assignments, non-working dates, and extra calendar days.

- Given the import succeeds
- When I open the old Gantt Builder
- Then the old saved plan is unchanged.

- Given no old plan exists
- When I choose import
- Then I see a clear empty/no-plan message.

#### Story GBN-02.3: Load GitLab-Based Tasks Into Beta

Use case:

- As a delivery lead
- I want to load GitLab-linked tasks into beta
- so that the beta plan starts from real project work.

Acceptance criteria:

- Given GitLab config is available
- When I select milestone-based loading
- Then beta loads GitLab tasks and assignees using the existing source rules.

- Given a milestone has start and due dates
- When I load that milestone
- Then the beta period can use the milestone date range after confirmation.

- Given tasks are loaded
- When I inspect a task
- Then GitLab project, IID, state, due date, estimate, spent time, labels, and assignees are preserved as read-only facts.

#### Story GBN-02.4: Preserve Plan Normalization Rules

Use case:

- As a PM
- I want imported plans to follow valid scheduling rules
- so that beta does not create impossible task dates.

Acceptance criteria:

- Given imported tasks contain weekend start dates
- When beta normalizes the plan
- Then starts move to the next working day according to non-working day rules.

- Given imported people have invalid capacity
- When beta normalizes the plan
- Then weekly capacity falls back to a valid default.

- Given imported assignments reference missing people
- When beta normalizes the plan
- Then invalid assignee references are removed or shown as unassigned.

### Epic GBN-03: Unified Task Grid And Timeline

Problem:

Users need task data and schedule bars in one aligned surface to reduce mode switching.

Split pattern:

- Simple/complex: read-only aligned view first, then inline edits, then row actions.

#### Story GBN-03.1: Show Read-Only Grid And Timeline Together

Use case:

- As a PM
- I want to see task rows and timeline bars side by side
- so that I understand the plan without switching tabs.

Acceptance criteria:

- Given a beta plan has tasks
- When I open the beta workspace
- Then the left side shows task rows and the right side shows matching timeline bars.

- Given I scroll vertically
- When task rows move
- Then the grid and timeline rows remain aligned.

- Given I scroll horizontally on the timeline
- When date columns move
- Then task names remain visible in the sticky task column.

#### Story GBN-03.2: Select Rows Across Grid And Timeline

Use case:

- As a delivery lead
- I want selected tasks highlighted across the grid and timeline
- so that I know exactly what I am editing.

Acceptance criteria:

- Given task rows are visible
- When I click a grid row
- Then the row and its timeline bar are highlighted.

- Given a timeline bar is visible
- When I click the bar
- Then the matching grid row is selected.

- Given a selected task is outside the viewport
- When I select it from a conflict or workload action
- Then the workspace scrolls it into view.

#### Story GBN-03.3: Edit Core Task Fields Inline

Use case:

- As a PM
- I want to edit common task fields inline
- so that routine planning is fast.

Acceptance criteria:

- Given a task row is visible
- When I edit title, status, progress, start, end, estimate, assignee, or role
- Then the task updates in the plan immediately.

- Given I edit start or end date
- When the value is valid
- Then the timeline bar moves or resizes to match.

- Given an invalid value is entered
- When the field loses focus
- Then the row shows an inline validation state and does not silently save invalid data.

#### Story GBN-03.4: Add Task From Grid

Use case:

- As a PM
- I want to add a task directly in the grid
- so that I can build the work breakdown without leaving the workspace.

Acceptance criteria:

- Given the grid is visible
- When I use the quick add row
- Then a new task is created with default estimate, start date, and empty assignee.

- Given the new task is created
- When I look at the timeline
- Then the new task has a visible bar or unassigned scheduled state.

#### Story GBN-03.5: Reorder Task Rows

Use case:

- As a PM
- I want to reorder tasks
- so that the plan communicates the work sequence clearly.

Acceptance criteria:

- Given multiple tasks exist
- When I drag a row handle above or below another task
- Then the visual order changes and persists after save/reload.

- Given GitLab-linked tasks are reordered
- When I save beta
- Then GitLab itself is not modified.

### Epic GBN-04: Timeline Interactions And Zoom

Problem:

Users need to plan by manipulating schedule bars directly, while preserving working-day rules.

Split pattern:

- Data entry methods: grid date edits first, then drag and resize UI.

#### Story GBN-04.1: Switch Timeline Zoom

Use case:

- As a PM
- I want day, week, and month timeline zoom
- so that I can plan details and review summaries in the same workspace.

Acceptance criteria:

- Given a plan is open
- When I switch zoom to day, week, or month
- Then the timeline redraws at that scale without losing task data.

- Given a task is selected
- When I change zoom
- Then the selected task remains selected.

- Given the current view is exported
- When export runs
- Then it uses the active zoom level.

#### Story GBN-04.2: Show Today Marker

Use case:

- As a delivery lead
- I want to see today's date on the timeline
- so that I can judge whether work is planned in the past or future.

Acceptance criteria:

- Given today is inside the visible date range
- When the timeline renders
- Then a vertical today marker is visible.

- Given today is outside the date range
- When the timeline renders
- Then no misleading today marker is shown.

#### Story GBN-04.3: Show Weekends And Non-Working Days

Use case:

- As a PM
- I want weekends and extra days off visually marked
- so that I can understand why bars skip dates.

Acceptance criteria:

- Given weekends are visible
- When the timeline renders
- Then weekend cells use a muted non-working style.

- Given a day is marked as extra non-working
- When the timeline renders
- Then that date is distinct from normal weekdays and weekends.

- Given display settings hide weekends
- When I toggle the setting
- Then weekends are visually compressed or hidden without losing schedule data.

#### Story GBN-04.4: Drag Task Bars To Move Dates

Use case:

- As a PM
- I want to drag task bars on the timeline
- so that I can quickly test schedule changes.

Acceptance criteria:

- Given a task bar is visible
- When I drag it to a new valid working-day start
- Then the task start and end update according to the existing schedule rules.

- Given the drag crosses non-working days
- When I drop the bar
- Then work is still scheduled only on working days.

- Given a drag creates a conflict
- When I drop the bar
- Then the conflict is shown without silently discarding the user's change unless the change is impossible.

#### Story GBN-04.5: Resize Task Bars

Use case:

- As a PM
- I want to resize task bars
- so that I can adjust planned duration or estimate directly from the timeline.

Acceptance criteria:

- Given a task bar is visible
- When I drag the resize handle
- Then the task duration and estimate update consistently with the selected scheduling model.

- Given the bar becomes very short
- When it renders
- Then text does not overflow or overlap adjacent UI.

Open question:

- Decide whether beta stores explicit duration or continues deriving duration from estimate and capacity.

### Epic GBN-05: Task Drawer

Problem:

Complex task editing should not clutter the main grid.

Split pattern:

- Workflow steps: open drawer, edit details, edit assignments, inspect GitLab facts.

#### Story GBN-05.1: Open And Close Task Drawer

Use case:

- As a PM
- I want to open a side drawer for a task
- so that complex edits happen without leaving the planning workspace.

Acceptance criteria:

- Given a task row or timeline bar is visible
- When I double-click it or click edit
- Then the task drawer opens on the right.

- Given the drawer is open
- When I press Escape or click close
- Then the drawer closes and the selected task remains visible.

#### Story GBN-05.2: Edit Task Details In Drawer

Use case:

- As a PM
- I want to edit detailed task fields in a drawer
- so that the grid remains compact.

Acceptance criteria:

- Given the drawer is open on the Details tab
- When I edit title, notes, status, progress, start, end, estimate, labels, or deadline
- Then the task updates in the grid and timeline.

- Given a required value is invalid
- When I try to commit it
- Then the drawer shows a field-level validation message.

#### Story GBN-05.3: Edit Assignments In Drawer

Use case:

- As an engineering lead
- I want to edit role estimates and per-person work in the drawer
- so that I can rebalance tasks without a crowded grid.

Acceptance criteria:

- Given the drawer is open on Assignments
- When I add, edit, or remove a role estimate
- Then total task estimate and timeline schedule update.

- Given an assignment has multiple people
- When I change a person's estimate or start date
- Then workload heatmap and timeline update for that person.

#### Story GBN-05.4: Inspect GitLab Facts In Drawer

Use case:

- As a PM
- I want to see GitLab facts separately from local plan fields
- so that I do not confuse source data with beta edits.

Acceptance criteria:

- Given a task is GitLab-linked
- When I open the GitLab drawer tab
- Then I see project/IID, state, due date, assignees, labels, spent time, and estimate as read-only facts.

- Given local assignees differ from GitLab
- When I inspect the drawer
- Then the difference is visible and linked to a conflict item.

### Epic GBN-06: Workload Heatmap

Problem:

Capacity risk should be visible without manually reading every task.

Split pattern:

- Simple/complex: display load first, then filtering and drilldowns.

#### Story GBN-06.1: Show Weekly Workload Heatmap

Use case:

- As an engineering lead
- I want a heatmap of planned hours by person and week
- so that I can spot overload quickly.

Acceptance criteria:

- Given tasks are assigned to people
- When the Workload panel is open
- Then each person has weekly cells showing planned hours and capacity.

- Given planned hours exceed capacity
- When the heatmap renders
- Then the overloaded cell is red and counted in the overload summary.

- Given planned hours are close to capacity
- When the heatmap renders
- Then the cell is amber.

#### Story GBN-06.2: Show Unassigned Workload

Use case:

- As a PM
- I want unassigned work visible in workload
- so that missing owners are not hidden.

Acceptance criteria:

- Given tasks have no assignee
- When the Workload panel renders
- Then an `Unassigned` row shows the unassigned planned work.

- Given I filter to unassigned work
- When the timeline updates
- Then only unassigned tasks remain visible.

#### Story GBN-06.3: Drill Into Workload Cell

Use case:

- As an engineering lead
- I want to click a workload cell
- so that I can see which tasks create that load.

Acceptance criteria:

- Given a workload cell has planned hours
- When I click the cell
- Then the timeline filters or focuses to that person and week.

- Given the cell is hovered or opened
- When task details are shown
- Then each contributing task, role, and hours are listed.

#### Story GBN-06.4: Recalculate Workload After Edits

Use case:

- As a PM
- I want workload to update after schedule edits
- so that capacity feedback is always current.

Acceptance criteria:

- Given I move, resize, assign, or change estimates on a task
- When the edit is committed
- Then workload cells update without page reload.

- Given a previously overloaded week becomes valid
- When workload recalculates
- Then the red overload state is removed.

### Epic GBN-07: Conflict Center

Problem:

Planning warnings are currently scattered. Users need one place to review and resolve risk.

Split pattern:

- Business rule variations: overload, GitLab reality, missing estimates, period boundaries.

#### Story GBN-07.1: Show Conflict Center Panel

Use case:

- As a PM
- I want all plan conflicts in one panel
- so that I can resolve the highest-risk issues first.

Acceptance criteria:

- Given conflicts exist
- When I open the Conflicts panel
- Then conflicts are grouped by severity and type.

- Given no conflicts exist
- When I open the panel
- Then I see a compact empty state.

#### Story GBN-07.2: Include Existing GitLab Reality Checks

Use case:

- As a delivery lead
- I want beta to reuse existing GitLab reality checks
- so that current warning logic is not lost.

Acceptance criteria:

- Given a GitLab task is closed but planned in the future
- When conflicts are calculated
- Then a warning appears.

- Given an open GitLab task is planned in the past
- When conflicts are calculated
- Then a warning appears.

- Given local assignees differ from GitLab assignees
- When conflicts are calculated
- Then a warning appears.

- Given spent time exceeds estimate
- When conflicts are calculated
- Then a warning appears.

#### Story GBN-07.3: Jump From Conflict To Task

Use case:

- As a PM
- I want conflict items to take me to the related task
- so that I can fix issues quickly.

Acceptance criteria:

- Given a conflict references a task
- When I click `Jump to task`
- Then the task row is selected, scrolled into view, and the drawer can open to the relevant tab.

#### Story GBN-07.4: Copy Or Export Conflict Summary

Use case:

- As a stakeholder reviewer
- I want to copy conflict summaries
- so that I can share plan risk outside the app.

Acceptance criteria:

- Given conflicts are visible
- When I click copy
- Then a plain-text summary of visible conflicts is copied.

- Given a PNG export runs for the current view
- When conflicts are visible in the exported area
- Then visible conflict information is included.

### Epic GBN-08: Export, Import, And Persistence

Problem:

Beta plans must be portable and recoverable just like existing workspace data.

Split pattern:

- Data variations: local save, workspace export/import, PNG export.

#### Story GBN-08.1: Save And Reload Beta Plans

Use case:

- As a PM
- I want beta plans to persist locally
- so that I can continue planning after refresh.

Acceptance criteria:

- Given I save a beta plan
- When I reload the app and open beta
- Then the saved beta plan loads with tasks, people, assignments, view settings, and non-working days.

- Given saved beta data is invalid or partially missing
- When beta loads
- Then it normalizes recoverable data and shows a clear error for unrecoverable data.

#### Story GBN-08.2: Include Beta Plans In Workspace Export

Use case:

- As a PM
- I want workspace export to include beta plans
- so that I can move my planning work between browser sessions.

Acceptance criteria:

- Given beta plans exist
- When I export workspace JSON
- Then beta plan entries are included under a separate beta key.

- Given the exported file is imported later
- When import completes
- Then beta plans are restored without overwriting old builder plans unless keys intentionally match.

#### Story GBN-08.3: Export Current Beta View As PNG

Use case:

- As a stakeholder
- I want the current beta view exported as PNG
- so that I can review the plan without opening the app.

Acceptance criteria:

- Given the beta workspace is visible
- When I export PNG
- Then the generated image reflects the current visible filters, zoom, and panels.

- Given the timeline is horizontally scrollable
- When export runs
- Then the exported content is not blank and does not crop essential visible context unexpectedly.

#### Story GBN-08.4: Keep Old Builder Export Behavior Unchanged

Use case:

- As an existing user
- I want old export behavior unchanged
- so that beta work does not regress current workflows.

Acceptance criteria:

- Given I use old Gantt Builder export
- When beta code exists
- Then old PNG/workspace export still behaves as before.

## Release 2: Planning Control

Goal: make beta a stronger PM planning tool with control points, sequencing, comparison, and batch editing.

### Epic GBN-09: Milestones And Deadlines

Problem:

Plans need visible commitment points beyond task start/end dates.

Split pattern:

- Operations: create, view, update, delete milestones/deadlines.

#### Story GBN-09.1: Create And Display Milestones

Use case:

- As a PM
- I want to create milestones on the timeline
- so that key delivery checkpoints are visible.

Acceptance criteria:

- Given the beta plan is open
- When I create a milestone with a title and date
- Then a diamond marker appears on the timeline.

- Given a milestone exists
- When I save and reload
- Then the milestone persists.

#### Story GBN-09.2: Assign Tasks To Milestones

Use case:

- As a PM
- I want to assign tasks to milestones
- so that I can group delivery work by checkpoint.

Acceptance criteria:

- Given milestones exist
- When I assign a task to a milestone in the grid or drawer
- Then the task shows the milestone value and can be grouped by milestone.

#### Story GBN-09.3: Set Task Deadlines

Use case:

- As a PM
- I want task deadlines separate from planned end dates
- so that I can see delivery risk before commitment dates are missed.

Acceptance criteria:

- Given a task is open
- When I set a deadline
- Then the task row and timeline show a deadline marker.

- Given planned end date is after deadline
- When conflicts are calculated
- Then an overdue/deadline conflict appears.

#### Story GBN-09.4: Export Milestones And Deadlines

Use case:

- As a stakeholder
- I want exported views to include milestones and deadlines
- so that the plan communicates commitments.

Acceptance criteria:

- Given milestones and deadlines are visible
- When I export PNG or workspace JSON
- Then milestone/deadline data is included.

### Epic GBN-10: Finish-To-Start Dependencies

Problem:

Users need basic sequencing rules to understand what schedule changes affect.

Split pattern:

- Simple/complex: finish-to-start only first; advanced dependency types later.

#### Story GBN-10.1: Create Finish-To-Start Dependency

Use case:

- As an engineering lead
- I want to connect one task as a predecessor of another
- so that sequencing risk is visible.

Acceptance criteria:

- Given two tasks exist
- When I create a finish-to-start dependency from task A to task B
- Then the dependency is stored and displayed as a line on the timeline.

- Given I try to create a dependency from a task to itself
- When I confirm
- Then the app blocks the dependency and explains why.

#### Story GBN-10.2: Detect Dependency Violations

Use case:

- As a PM
- I want invalid dependencies flagged
- so that I know when a plan sequence is unrealistic.

Acceptance criteria:

- Given task B depends on task A finishing first
- When task B starts before task A ends
- Then the dependency line is red and a conflict appears.

- Given the dates become valid again
- When conflicts recalculate
- Then the dependency conflict disappears.

#### Story GBN-10.3: Prevent Circular Dependencies

Use case:

- As a PM
- I want circular dependencies blocked
- so that the plan remains schedulable.

Acceptance criteria:

- Given A depends on B
- When I try to make B depend on A
- Then the app blocks the change and shows a clear circular dependency message.

#### Story GBN-10.4: Confirm Auto-Shift Of Successors

Use case:

- As a PM
- I want the app to ask before shifting dependent tasks
- so that schedule automation never surprises me.

Acceptance criteria:

- Given a predecessor moves later
- When successors would violate dependency rules
- Then the app offers to shift affected successors.

- Given I decline the shift
- When the move completes
- Then dates remain as placed and conflicts show.

- Given I accept the shift
- When the move completes
- Then successors move to the next valid working dates.

### Epic GBN-11: Baseline And Variance

Problem:

PMs need to compare current plan against an approved plan.

Split pattern:

- Operations: create baseline, view baseline, reset baseline.

#### Story GBN-11.1: Set Active Baseline

Use case:

- As a PM
- I want to save the current plan as a baseline
- so that future changes can be compared against it.

Acceptance criteria:

- Given a beta plan has tasks
- When I click `Set baseline` and confirm
- Then the current task dates and key fields are saved as the active baseline.

- Given a baseline already exists
- When I set a new baseline
- Then I must confirm replacing the existing baseline.

#### Story GBN-11.2: Show Baseline Bars

Use case:

- As a stakeholder
- I want baseline bars behind current bars
- so that I can see schedule drift visually.

Acceptance criteria:

- Given a baseline exists
- When `Show baseline` is enabled
- Then muted baseline bars appear behind or below current task bars.

- Given `Show baseline` is disabled
- When the timeline renders
- Then baseline bars are hidden without deleting baseline data.

#### Story GBN-11.3: Show Baseline Variance Summary

Use case:

- As a PM
- I want a variance summary
- so that I can explain what slipped, moved earlier, or stayed the same.

Acceptance criteria:

- Given a baseline exists
- When I open the Baseline panel
- Then I see counts and task lists for slipped, pulled-in, and unchanged tasks.

- Given a task moved by multiple days
- When variance is shown
- Then the task displays a signed day delta.

### Epic GBN-12: Bulk Editing

Problem:

Planning with many tasks requires efficient batch operations.

Split pattern:

- Operations: select, edit selected, clear selection.

#### Story GBN-12.1: Select Multiple Tasks

Use case:

- As a PM
- I want to select multiple task rows
- so that I can apply the same change to several tasks.

Acceptance criteria:

- Given task rows are visible
- When I use row checkboxes or shift-click
- Then multiple rows become selected.

- Given rows are selected
- When I clear selection
- Then all bulk actions are disabled.

#### Story GBN-12.2: Bulk Assign People Or Role

Use case:

- As an engineering lead
- I want to bulk assign people or roles
- so that I can quickly structure ownership.

Acceptance criteria:

- Given multiple tasks are selected
- When I choose a person or role in bulk edit
- Then selected tasks update according to the chosen operation.

- Given selected tasks already have assignments
- When I apply bulk edit
- Then I can choose replace or append behavior where relevant.

#### Story GBN-12.3: Bulk Update Status, Milestone, Or Dates

Use case:

- As a PM
- I want to bulk update status, milestone, or dates
- so that large planning changes are not repetitive.

Acceptance criteria:

- Given multiple tasks are selected
- When I bulk update status or milestone
- Then all selected tasks update.

- Given I bulk shift dates by N working days
- When the operation completes
- Then selected task schedules move by N valid working days and conflicts recalculate.

### Epic GBN-13: Grouping And View Settings

Problem:

Different review modes need different visible information without changing the plan.

Split pattern:

- Business rule variations: grouping by milestone, assignee, project, status.

#### Story GBN-13.1: Group Tasks

Use case:

- As a PM
- I want to group tasks by planning dimension
- so that I can review the plan from different angles.

Acceptance criteria:

- Given tasks exist
- When I group by milestone, assignee, project, or status
- Then grid and timeline show grouped sections.

- Given grouping is disabled
- When I switch to none
- Then the plan returns to the saved task order.

#### Story GBN-13.2: Configure Visible Columns

Use case:

- As a PM
- I want to choose visible grid columns
- so that the workspace fits the current review task.

Acceptance criteria:

- Given view settings are open
- When I hide or show a column
- Then the grid updates without deleting any task data.

- Given column settings are changed
- When I reload beta
- Then the settings persist locally.

#### Story GBN-13.3: Use View Presets

Use case:

- As a stakeholder reviewer
- I want quick view presets
- so that I can switch between planning, capacity, stakeholder, and GitLab review modes.

Acceptance criteria:

- Given beta is open
- When I choose `Planning`, `Capacity review`, `Stakeholder summary`, or `GitLab reality check`
- Then grouping, columns, panels, and display toggles update to the preset.

- Given a preset is applied
- When I edit task data
- Then only view state changes from the preset; task data remains unchanged.

## Release 3: Advanced Scheduling

Goal: support complex plans after beta foundation and planning control are validated.

### Epic GBN-14: Advanced Dependencies And Critical Path

Problem:

Some projects need richer dependency logic and critical path visibility.

Split pattern:

- Data variations: dependency type and lag/lead.

#### Story GBN-14.1: Support Additional Dependency Types

Use case:

- As an engineering lead
- I want start-to-start and finish-to-finish dependencies
- so that non-linear sequencing can be represented.

Acceptance criteria:

- Given dependency editing is available
- When I choose dependency type
- Then finish-to-start, start-to-start, and finish-to-finish are supported.

#### Story GBN-14.2: Add Lag And Lead

Use case:

- As a PM
- I want lag or lead on dependencies
- so that required waits or overlaps are visible.

Acceptance criteria:

- Given a dependency exists
- When I set lag or lead in working days
- Then dependency validation uses that offset.

#### Story GBN-14.3: Highlight Critical Path

Use case:

- As a PM
- I want critical path highlighted
- so that I know which tasks affect the final delivery date.

Acceptance criteria:

- Given dependencies exist
- When I enable critical path
- Then tasks on the critical path are visually highlighted.

- Given a critical path task moves
- When the plan recalculates
- Then critical path highlighting updates.

### Epic GBN-15: Plan Variants And Scenarios

Problem:

PMs often compare alternate plans before committing.

Split pattern:

- Operations: duplicate, rename, switch, delete scenario.

#### Story GBN-15.1: Duplicate Plan As Scenario

Use case:

- As a PM
- I want to duplicate the current plan as a scenario
- so that I can test changes without losing the baseline plan.

Acceptance criteria:

- Given a beta plan exists
- When I duplicate it
- Then a new named scenario is created with the same tasks and settings.

#### Story GBN-15.2: Switch Between Scenarios

Use case:

- As a PM
- I want to switch between scenarios
- so that I can compare planning options.

Acceptance criteria:

- Given multiple scenarios exist
- When I switch scenario
- Then the grid, timeline, workload, conflicts, and baseline data update to that scenario.

#### Story GBN-15.3: Delete Scenario With Confirmation

Use case:

- As a PM
- I want to delete unused scenarios safely
- so that workspace data stays clean.

Acceptance criteria:

- Given a non-active scenario exists
- When I delete it
- Then I must confirm before deletion.

### Epic GBN-16: Edit History

Problem:

Users need to understand what changed locally over time.

Split pattern:

- Simple/complex: session-level history first, persistent history later.

#### Story GBN-16.1: Show Recent Local Changes

Use case:

- As a PM
- I want to see recent local changes
- so that I can understand how the plan evolved.

Acceptance criteria:

- Given I edit tasks in beta
- When I open History
- Then recent task/date/assignee changes are listed with timestamp and field name.

#### Story GBN-16.2: Restore From Recent Change

Use case:

- As a PM
- I want to restore a recent local change
- so that I can recover from accidental edits.

Acceptance criteria:

- Given a recent change is listed
- When I choose restore
- Then the related field returns to its previous value after confirmation.

### Epic GBN-17: Share And Rich Export

Problem:

Stakeholders need readable plan outputs beyond screenshots.

Split pattern:

- Data variations: read-only HTML/JSON snapshot, XLSX/CSV grid export.

#### Story GBN-17.1: Export Task Grid As CSV/XLSX

Use case:

- As a stakeholder
- I want the beta task grid exported as CSV or XLSX
- so that I can review or analyze it outside the app.

Acceptance criteria:

- Given a beta plan is open
- When I export the task grid
- Then visible task fields export in the current order and with current filters.

#### Story GBN-17.2: Create Read-Only Snapshot

Use case:

- As a PM
- I want to generate a read-only plan snapshot
- so that stakeholders can review the plan without editing it.

Acceptance criteria:

- Given a beta plan is open
- When I create a snapshot
- Then the app generates a read-only JSON or HTML artifact with tasks, timeline summary, workload, conflicts, and baseline state.

## Enabling Engineering Tasks

These are not user stories, but they reduce implementation risk.

### ENG-01: Beta Data Model Decision

Question:

- Should beta store explicit duration, or derive duration from estimate and capacity as the current builder does?

Output:

- Short decision record.
- Migration implications.
- Test cases for task date calculation.

### ENG-02: Shared Scheduling Utility Boundaries

Question:

- Which current `ganttBuilder.ts` scheduling utilities can be reused without coupling beta too tightly to the old UI?

Output:

- List of shared utilities.
- List of beta-only utilities.
- Regression tests for working-day scheduling.

### ENG-03: Performance Spike For Large Plans

Question:

- Can the beta grid/timeline remain usable with 100, 300, and 1000 tasks?

Output:

- Prototype or benchmark.
- Rendering strategy recommendation.
- Virtualization decision if needed.

### ENG-04: Export Surface Feasibility

Question:

- Can PNG export capture the split grid/timeline/workload surface reliably?

Output:

- Export approach.
- Known limitations.
- Test plan for wide timelines.

## Recommended Build Order

1. GBN-01.1, GBN-01.2, GBN-01.3 - beta route, shell, storage namespace.
2. GBN-02.1, GBN-02.2 - create/import local plans.
3. GBN-03.1, GBN-03.2 - read-only unified grid/timeline and selection.
4. GBN-03.3, GBN-04.1, GBN-04.2 - inline edits, zoom, today marker.
5. GBN-05.1, GBN-05.2, GBN-05.3 - drawer and assignment editing.
6. GBN-04.4, GBN-04.5 - drag and resize.
7. GBN-06.1, GBN-06.2, GBN-06.4 - workload heatmap.
8. GBN-07.1, GBN-07.2, GBN-07.3 - conflict center.
9. GBN-08.1, GBN-08.2, GBN-08.3 - persistence and exports.
10. Release 2 starts with GBN-09 and GBN-10 only after Release 1 is usable.

## Release 1 Definition Of Done

Release 1 is done when:

- old Gantt Builder still works unchanged;
- beta page is reachable and clearly marked as beta;
- beta plans save under separate storage;
- old plans can be copied into beta;
- grid and timeline are aligned and editable;
- drawer supports task details and assignments;
- day/week/month zoom works;
- today marker and non-working days are visible;
- workload heatmap updates after edits;
- conflict center shows current warning types;
- workspace export/import preserves beta plans;
- PNG export works for the current beta view;
- basic responsive behavior is acceptable for narrow screens.

## Release 1 Risks

- Timeline/grid row alignment can become fragile if row heights vary.
- Drag/resize behavior can conflict with derived estimate/capacity scheduling.
- Large plans may require virtualization earlier than expected.
- Workspace export/import needs careful key separation to avoid old plan data loss.
- Bottom panel plus drawer can overcrowd smaller screens.

## Deferred Or Explicitly Out Of Scope

- AI generation or AI scheduling.
- Real-time collaboration.
- Full portfolio planning.
- Replacing old Gantt Builder.
- Advanced dependency types before finish-to-start is validated.
- Critical path before dependencies are stable.
