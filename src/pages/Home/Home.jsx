import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  SpaceTree,
  TaskList,
  TaskBoard,
  MonthPicker,
  TaskPanel,
  TaskEditorModal,
  ConfirmModal,
  HelpModal,
  FilePreviewModal,
  TaskPreviewModal,
  ConfigEditorModal,
  WorkEditModal,
  AddSpaceModal,
  RepositoryEditModal,
  IncomeAnalysisModal,
  LanguageSwitcher,
  UserMenu,
  RunModal,
} from "@components";
import {
  PlusIcon,
  SearchIcon,
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshIcon,
  PieIcon,
  ListIcon,
  BoardIcon,
} from "@components/icons";
import { BOARD_STATUSES, boardStatus } from "@components/TaskBoard";
import { showToast, Checkbox } from "@ui";
import { useAuth } from "@store";
import * as api from "@utils/api";
import { ALL_MONTHS, inPeriod, taskMonths, monthLabel, previewKind, flattenTasks, filterTasks, formatDateTime } from "@utils/task";
import { groupWorksByOrigin, runName, runId, ambiguousRunNames } from "@utils/works";
import { copyText } from "@utils/clipboard";
import { useTaskFiles } from "@components/Attachments";
import useRuns from "@hooks/useRuns";
import { useShortcuts, useWheelSteps, moveIndex, isTyping } from "@utils/keys";
import styles from "./home.module.css";

const EMPTY_DIR = {
  dir: "",
  absDir: "",
  isRoot: true,
  parent: null,
  crumbs: [],
  tasks: [],
  counts: { todo: 0, done: 0, pending: 0, aborted: 0 },
};

function readFlag(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

// The task view: "list", or "board" (the progress view).
function readView() {
  try {
    return localStorage.getItem("tasks.view") === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

function writeFlag(key, value) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// A key for a task that is unique across spaces, for the selection.
const keyOf = (space, rel) => `${space.work}/${space.repository || ""}/${rel}`;

// The one page: the origins, works and repositories as a tree on the left, the tasks of the chosen
// one on the right. What is shown is in the path (/ for every task, /o/:origin for every task of an origin,
// /o/:origin/:work for a work's tasks and its repositories', and one more segment for a repository) and the folder
// inside a space in ?dir=, so back/forward and reload keep both. A work with ?dir= is a folder in
// the work's own tasks.
// The tooltip of the dot after the sync server in the status bar: how taskmgrd's last pull went
// (see api.getPolling); "" when the daemon does not poll, or nothing is known yet.
function pollingTitle(polling, t) {
  if (!polling?.on) return "";
  if (!polling.at) return t("status.pollingNone");
  const when = formatDateTime(polling.at);
  if (!polling.ok) return t("status.pollingFailed", { when, error: polling.error || "" });
  return polling.fresh ? t("status.pollingOk", { when }) : t("status.pollingStale", { when });
}

export default function Home({ all = false }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const { origin = "", work = "", repository = "" } = useParams();
  const space = useMemo(() => (work ? { origin, work, repository } : null), [origin, work, repository]);
  const spaceTo = all ? api.allPath : work ? api.spacePath(origin, work, repository) : api.originPath(origin);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const dir = searchParams.get("dir") || "";
  // The tasks of several spaces in one list: every work, a whole origin, or a work at its top.
  const scope = useMemo(
    () => (all ? { all: "1" } : origin && !work ? { origin } : work && !repository && !dir ? { work } : null),
    [all, origin, work, repository, dir],
  );

  const [works, setWorks] = useState(null);
  const [origins, setOrigins] = useState([]); // the named origins, { origin, income }, some maybe without works
  const [worksError, setWorksError] = useState("");
  const [treeOpen, setTreeOpen] = useState(() => readFlag("panel.tree", true));
  const [detailOpen, setDetailOpen] = useState(() => readFlag("panel.detail", true));
  const [pane, setPane] = useState("tasks"); // where j / k and friends go: "tree" or "tasks"
  // The list last loaded and the path it is for. On any other path `data` is empty and `loading`
  // until this path's own list arrives. That is decided while rendering, not in an effect after a
  // commit, so a click on a task's from tag never shows the previous list (with the tags gone)
  // first, not even for one frame. Re-reading the path shown (the periodic reload, the refresh
  // button) is not "loading": what is shown stays, even an empty list's "no tasks", until the
  // list that arrives differs (see `load`), so nothing flickers while nothing changed.
  const [loaded, setLoaded] = useState({ key: null, dir: EMPTY_DIR });
  const loadKey = JSON.stringify([scope, space, dir]);
  const data = loaded.key === loadKey ? loaded.dir : EMPTY_DIR;
  const loading = loaded.key !== loadKey;
  const [loadError, setLoadError] = useState("");
  // How many lists arrived, changed or not: the selected task's attachments re-read themselves on
  // it (see useTaskFiles), since a file pushed from another machine changes no list.
  const [loads, setLoads] = useState(0);
  const [query, setQuery] = useState("");
  // The new task modal is open: { space, dir, status, parent }, where the task goes (in a task
  // folder with `parent`, the task it is a subtask of) and the board column it belongs to.
  const [creating, setCreating] = useState(null);
  const searchRef = useRef(null);
  const [focusing, setFocusing] = useState(null); // { key, area }: the task whose text ("task") or prompt ("prompt") the panel should focus
  const [promptOpen, setPromptOpen] = useState(() => readFlag("panel.prompt", false)); // the panel shows the task's prompt.txt under its text
  const [peekPromptOpen, setPeekPromptOpen] = useState(() => readFlag("preview.prompt", false)); // and the preview, on its own
  const [section, setSection] = useState("task"); // with the prompt shown, the text the keyboard is on in the panel: "task" or "prompt"
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // task to delete
  const [deleting, setDeleting] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null); // the task the shortcuts act on
  const [help, setHelp] = useState(false);
  const [command, setCommand] = useState(null); // text after ":" while in command mode
  const [preview, setPreview] = useState(null); // attachment shown in the preview modal
  const [previewEditing, setPreviewEditing] = useState(false); // the preview's text file being edited
  const closePreview = () => {
    setPreview(null);
    setPreviewEditing(false);
  };
  const [peek, setPeek] = useState(null); // task whose task.txt is shown, on space or a double click
  const [configOpen, setConfigOpen] = useState(false);
  const [editingWork, setEditingWork] = useState(null); // work whose name and income are being edited
  const [adding, setAdding] = useState(null); // what the add modal starts with: { type, origin, work }
  const [editingOrigin, setEditingOrigin] = useState(null); // { origin, income } of the origin being edited
  const [editingRepository, setEditingRepository] = useState(null); // { work, name, paths } of the repository being edited
  const [removing, setRemoving] = useState(null); // { origin } or { work, repository? } to remove from taskmgr.json
  const [showHidden, setShowHidden] = useState(() => readFlag("tree.showHidden", false)); // the tree shows hidden works too
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [view, setView] = useState(readView);
  const [month, setMonth] = useState(ALL_MONTHS); // when the tasks were created: all, last / this week, or a month
  const [showDone, setShowDone] = useState(() => readFlag("tasks.showDone", true)); // the list shows done tasks too
  const [showPending, setShowPending] = useState(() => readFlag("tasks.showPending", true)); // and pending ones
  const [showAbort, setShowAbort] = useState(() => readFlag("tasks.showAbort", true)); // and aborted ones (the board's aborted column too)

  useEffect(() => writeFlag("panel.tree", treeOpen), [treeOpen]);
  useEffect(() => writeFlag("panel.detail", detailOpen), [detailOpen]);
  useEffect(() => writeFlag("panel.prompt", promptOpen), [promptOpen]);
  useEffect(() => writeFlag("preview.prompt", peekPromptOpen), [peekPromptOpen]);
  useEffect(() => writeFlag("tree.showHidden", showHidden), [showHidden]);
  useEffect(() => writeFlag("tasks.showDone", showDone), [showDone]);
  useEffect(() => writeFlag("tasks.showPending", showPending), [showPending]);
  useEffect(() => writeFlag("tasks.showAbort", showAbort), [showAbort]);
  useEffect(() => {
    try {
      localStorage.setItem("tasks.view", view);
    } catch {
      /* ignore */
    }
  }, [view]);

  // The works in the tree: the hidden ones only when they are shown.
  const treeWorks = useMemo(() => (works && !showHidden ? works.filter((w) => !w.hidden) : works), [works, showHidden]);
  const hiddenCount = (works || []).filter((w) => w.hidden).length;

  // The { works, origins } every change to taskmgr.json answers with.
  const setSpaces = useCallback((d) => {
    setWorks(d.works);
    setOrigins(d.origins || []);
    setWorksError("");
  }, []);

  const loadSpaces = useCallback(async () => {
    try {
      setSpaces(await api.listSpaces());
    } catch (e) {
      setWorksError(e.message);
    }
  }, [setSpaces]);

  // Only the latest load may set the list: an earlier one answering late (after the path changed)
  // would put another space's tasks on the right.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const d = scope ? await api.listAllTasks(scope) : await api.listTasks(space, dir);
      if (seq !== loadSeq.current) return;
      // The same list again (most periodic reloads) keeps the state it has: nothing re-renders,
      // and nothing that follows `data` (the selected task's attachments) re-reads itself.
      setLoaded((prev) => (prev.key === loadKey && JSON.stringify(prev.dir) === JSON.stringify(d) ? prev : { key: loadKey, dir: d }));
      setLoads((n) => n + 1);
      setLoadError("");
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setLoaded({ key: loadKey, dir: EMPTY_DIR });
      setLoadError(e.message);
    }
  }, [scope, space, dir, loadKey]);

  // Whether taskmgrd polls the sync server and how its last pull went (see api.getPolling), for the
  // dot after the server's host in the status bar; null until the first answer. A failed read keeps
  // what is shown.
  const [polling, setPolling] = useState(null);
  const loadPolling = useCallback(async () => {
    try {
      setPolling(await api.getPolling());
    } catch {
      /* keep the last state */
    }
  }, []);

  // Re-read the works as well: a task folder may have been created or removed. And the polling
  // state, which the periodic reload and the refresh button keep current this way.
  const reload = useCallback(() => Promise.all([load(), loadSpaces(), loadPolling()]), [load, loadSpaces, loadPolling]);

  useEffect(() => {
    loadSpaces();
    loadPolling();
  }, [loadSpaces, loadPolling]);

  // The host of the server this machine syncs with (SYNC_SERVER in .env), for the status bar's right
  // end; "" when there is none. Read once: it changes only with a restart.
  const [syncServer, setSyncServer] = useState("");
  useEffect(() => {
    api.getSettings().then((s) => setSyncServer(s.syncServer || ""), () => {});
  }, []);

  // The page re-reads itself every ten seconds while the tab is visible: the tasks, for changes
  // pushed from another machine or made with the cli, and the works, which keeps the dot beside a
  // machine id (see MachineDot) current, since it goes grey three minutes after that machine's last
  // push or poll.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 10 * 1000);
    return () => clearInterval(id);
  }, [reload]);

  // The root (every origin's tasks) is just "taskmgr".
  useEffect(() => {
    document.title = work ? `taskmgr - ${work}${repository ? ` / ${repository}` : ""}` : origin ? `taskmgr - ${origin}` : "taskmgr";
  }, [origin, work, repository]);

  // Replace old /w links with the canonical origin path once the config is available.
  useEffect(() => {
    if (!work || origin || !works) return;
    const canonicalOrigin = works.find((item) => item.work === work)?.origin;
    if (canonicalOrigin)
      navigate(
        { pathname: api.spacePath(canonicalOrigin, work, repository), search: searchParams.toString() },
        { replace: true },
      );
  }, [origin, work, repository, works, navigate, searchParams]);

  // A new path (`load` is remade for it) loads its list; until it arrives the page is empty and
  // "loading" (see `data`). The periodic reload and the retry button call `load` directly, and the
  // list stays while they run.
  useEffect(() => {
    setQuery("");
    load();
  }, [load]);

  // The tree's rows in order (all origins, each origin, then its works and their repositories),
  // including the spaces whose folder is missing.
  const spaces = useMemo(
    () => [
      { to: api.allPath, exists: true },
      ...groupWorksByOrigin(treeWorks, origins).flatMap((g) => [
        ...(g.origin ? [{ to: api.originPath(g.origin), exists: true }] : []),
        ...g.works.flatMap((w) => [
          { to: api.spacePath(g.origin, w.work), root: w.root, exists: w.exists },
          ...w.repositories.map((p) => ({ to: api.spacePath(g.origin, w.work, p.name), root: p.root, exists: p.exists })),
        ]),
      ]),
    ],
    [treeWorks, origins],
  );
  // The space on the right when its task folder does not exist. A list of several spaces just
  // leaves the missing ones out.
  const missing = (!scope && spaces.find((s) => s.to === spaceTo && !s.exists)) || null;

  const selectSpace = (to, replace = false) => {
    if (to !== spaceTo || dir) navigate(to, { replace });
  };

  // Every task with the space it lives in, a key unique across spaces, and, in a list of several
  // spaces, where it is from: its repository, or its work for a work's own task in an origin's or
  // in all of them. The whole work / repository path is kept for the hover title and search. The
  // tasks are a tree (each with its subtasks, which live in the same space); `tree` keeps that
  // shape, `tasks` is every task as a row under its parent, in the list's order.
  const tree = useMemo(
    () =>
      // A task of one space has no space of its own to show on an origin's page (which can only
      // happen with a list that is not this path's), so it is left out.
      data.tasks.flatMap((t) => {
        const s =
          t.work !== undefined
            ? { origin: (works || []).find((item) => item.work === t.work)?.origin || "", work: t.work, repository: t.repository }
            : space;
        if (!s) return [];
        // On a work's page (which has the origin in its path too) a task is from its repository only.
        const path = !scope ? [] : scope.work ? [s.repository].filter(Boolean) : [s.work, s.repository].filter(Boolean);
        const from = path.join(" / ");
        const fromParts = path.slice(-1);
        const decorate = (task) => ({
          ...task,
          space: s,
          key: keyOf(s, task.rel),
          from,
          fromParts,
          subtaskCount: (task.subtasks || []).length, // all of them, whatever a filter keeps (the board's subtasks button)
          subtasks: (task.subtasks || []).map(decorate),
        });
        return decorate(t);
      }),
    [data.tasks, space, scope, works],
  );
  const tasks = useMemo(() => flattenTasks(tree), [tree]);

  // The time filter's entries (all, last / this week, then the months, this one first); a month
  // that this list has no task from shows every task.
  const months = useMemo(() => taskMonths(tasks), [tasks]);
  const monthIndex = Math.max(
    0,
    months.findIndex((m) => m.key === month),
  );
  const monthKey = months[monthIndex].key;

  // The board's columns: todo, done and pending always, aborted only while aborted tasks are shown.
  const boardStatuses = useMemo(() => BOARD_STATUSES.filter((s) => s !== "aborted" || showAbort), [showAbort]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const keep = (t) =>
      inPeriod(t, monthKey) &&
      (!q || t.title.toLowerCase().includes(q) || t.id.includes(q) || t.from.toLowerCase().includes(q)) &&
      (showAbort || t.status !== "aborted") &&
      (view === "board" || ((showDone || t.status !== "done") && (showPending || t.status !== "pending")));
    // A task stays when a subtask of it is kept, so a filter never hides a task that matches it.
    // The list shows every task under its parent, and leaves the done, the pending and the aborted
    // tasks out unless they are shown. The board always has its todo / done / pending columns, and
    // its aborted column while aborted tasks are shown; only the tasks at the top are its cards,
    // each in the column of its status (its subtasks are a board of their own, see enterTask), and
    // on it j / k go down a column and on into the next one.
    const kept = filterTasks(tree, keep);
    if (view !== "board") return flattenTasks(kept);
    return boardStatuses.flatMap((s) => kept.filter((t) => boardStatus(t) === s));
  }, [tree, query, view, showDone, showPending, showAbort, boardStatuses, monthKey]);

  // No row is selected until one is chosen, or when the selected task is not in this list (a new
  // folder, a filter, a deleted task); j (or a wheel notch down) then starts from the first row.
  const selectedIndex = visible.findIndex((t) => t.key === selectedKey);
  const selected = visible[selectedIndex] || null;

  // The runs of Claude Code on tasks (started by the run button beside a prompt), followed live by
  // useRuns.
  // The run button opens the run's dialog (`runKey`: the task whose run it shows), starting a run
  // when the task has none; the dialog shows the run as it is now, so a new run on the same task
  // shows there too. A question Claude asks, on whatever task, shows as a toast.
  // A run over leaves its record in the task folder (see ai/record.js): the selected task's files
  // are re-read, so the list of runs under the prompt shows it at once.
  const ai = useRuns({
    onAsk: (run) => showToast(t("ai.asks", { title: run.task.title }), 6000),
    onEnd: () => setLoads((n) => n + 1),
  });
  const selectedRun = ai.runFor(selected);
  // Where the selected task would run: here, or, for a copy pushed from another machine, on that
  // machine (see server/ai.js), which needs its taskmgrd connected as a runner (AI_RUNNER=1 there).
  // The reason it cannot now, for the run button; null when it can, or nothing is known yet.
  const noRunner = useMemo(() => {
    const sp = selected?.space;
    const w = sp && works?.find((x) => x.work === sp.work);
    const s = w && (sp.repository ? w.repositories.find((p) => p.name === sp.repository) : w);
    if (!s?.remote) return null;
    if (!s.machine) return t("ai.noMachine");
    return s.machine.runner ? null : t("ai.noRunner", { machine: s.machine.name });
  }, [selected, works, t]);
  // The selected task's attachments; on the Task panel j / k walk them and space opens one. Also the
  // records of its runs of Claude Code (attachments.runs), which the run button shows when the task
  // has no run going.
  const attachments = useTaskFiles(selected?.space, selected?.rel, loads);
  const [runKey, setRunKey] = useState(null);
  const [runFolder, setRunFolder] = useState(null); // a record picked from the list under the prompt, shown whatever run is going
  const runTask = runKey ? tasks.find((task) => task.key === runKey) || null : null;
  // The records are the selected task's: the dialog shows them for that task only.
  const savedRuns = runTask && runTask.key === selected?.key ? attachments.runs : [];
  const [starting, setStarting] = useState(false); // a run asked for and not answered yet: the dialog says so, rather than showing the task's last run
  const isGoing = (run) => !!run && (run.status === "running" || run.status === "queued");
  const openRun = async (task, folder = null) => {
    setRunKey(task.key);
    setRunFolder(folder);
    if (folder) {
      selectRun(folder); // the keyboard is on the record opened, so space closes and opens it again
      return;
    }
    if (isGoing(ai.runFor(task))) return; // the run going opens
    // else a run starts; refused (the machine not connected, say), the dialog closes again
    setStarting(true);
    const ok = await ai.start(task);
    setStarting(false);
    if (!ok) closeRun();
  };
  const closeRun = () => {
    setRunKey(null);
    setRunFolder(null);
    setLoads((n) => n + 1); // whatever the run left in the task folder (its record, its files) shows now
  };
  const [fileRel, setFileRel] = useState(null);
  const fileList = attachments.files.filter((f) => !f.isDir);
  const fileIndex = fileList.findIndex((f) => f.rel === fileRel);
  const selectedFile = fileList[fileIndex] || null;
  // The run record the keyboard is on, among those listed under the prompt (j / k walk them after
  // the prompt; space opens one in the run dialog, d removes it). One thing is chosen at a time: a
  // file, a record, or a text (see selectSection).
  const [pickedRun, setPickedRun] = useState(null);
  const pickedRecord = attachments.runs.find((r) => r.folder === pickedRun) || null;
  const selectFile = (rel) => {
    setFileRel(rel);
    setPickedRun(null);
  };
  const selectRun = (folder) => {
    setPickedRun(folder);
    setFileRel(null);
  };
  // Remove a run's record (d on it, or its ×): the delete popup asks first, as for a file (d again
  // confirms; see confirmDeleteFile), then the highlight moves to the next record, else the previous,
  // else off.
  const forgetRecord = (record) => setRemovingFile({ hook: attachments, record });
  // The same for the task preview opened with space: j / k pick a file, enter opens it.
  // peek holds the key; the task itself is read fresh, so a saved edit shows at once
  const peekTask = tasks.find((task) => task.key === peek?.key) || peek;
  const [peekEditing, setPeekEditing] = useState(null); // the preview's text being edited: "task", "prompt" or null
  const [peekSection, setPeekSection] = useState(null); // the text the keyboard is on in the preview: "task" or "prompt", null until j / k chose one
  const peekAttachments = useTaskFiles(peekTask?.space, peekTask?.rel, loads);
  const peekFiles = peekAttachments.files.filter((f) => !f.isDir);
  const [peekFileRel, setPeekFileRel] = useState(null);
  const peekFile = peekFiles.find((f) => f.rel === peekFileRel) || null;
  const closePeek = () => {
    setPeek(null);
    setPeekFileRel(null);
    setPeekEditing(null);
    setPeekSection(null);
  };
  // d on a file asks in a popup; confirming (d again, or the button) deletes it and moves the highlight to its neighbour.
  // The same popup asks before the task's prompt.txt is deleted (`prompt`: the divider's delete, or
  // d on the prompt); deleting it is saving a blank prompt (see useTaskFiles). And before a run's
  // record is removed (`record`, see forgetRecord).
  const [removingFile, setRemovingFile] = useState(null); // { hook, list, file, setRel }, { hook, file, prompt: true } or { hook, record }
  const deleteFile = (hook, list, file, setRel) => setRemovingFile({ hook, list, file, setRel });
  // `after` runs once the prompt is deleted: the panel or the preview it was deleted from hides the prompt.
  const deletePrompt = (hook, task, after) => setRemovingFile({ hook, file: { name: "prompt.txt", rel: `${task.rel}/prompt.txt` }, prompt: true, after });
  const confirmDeleteFile = async () => {
    const { hook, list, file, setRel, prompt, after, record } = removingFile;
    setRemovingFile(null);
    if (record) {
      const runs = hook.runs;
      const i = runs.findIndex((r) => r.folder === record.folder);
      if (!(await hook.forgetRun(record.folder))) return;
      if (pickedRun === record.folder) selectRun((runs[i + 1] || runs[i - 1])?.folder || null);
      return;
    }
    if (prompt) {
      if (!(await hook.savePrompt(""))) return;
      setLoads((n) => n + 1); // the other reader of the folder (panel or preview) follows
      after?.();
      return;
    }
    const i = list.indexOf(file);
    if (await hook.remove(file)) setRel((list[i + 1] || list[i - 1] || null)?.rel ?? null);
  };
  // The file shown in the preview, in the list it came from (the task preview's, else the panel's):
  // d, or the preview's delete button, deletes it as d on a file chosen in that list does (asking
  // first); the preview closes once it is gone and the highlight moves to its neighbour. Null for
  // a file from elsewhere (the task editor's), which the preview cannot delete.
  const previewList = peek ? peekFiles : fileList;
  const previewEntry = preview ? previewList.find((f) => f.rel === preview.rel) : null;
  const deletePreviewFile = previewEntry
    ? () =>
        deleteFile(peek ? peekAttachments : attachments, previewList, previewEntry, (rel) => {
          (peek ? setPeekFileRel : setFileRel)(rel);
          closePreview();
        })
    : null;

  // The brain on the panel shows and hides the prompt under the task's text, the one on the preview
  // the prompt there, each on its own (and kept across sessions, as the panes are); hidden, the
  // keyboard is back on the task's text (in the preview only when it was on the prompt: a file
  // chosen there, or nothing yet, stays). Deleting a prompt hides it too (see confirmDeleteFile).
  function showPrompt(open) {
    setPromptOpen(open);
    if (!open) {
      setSection("task");
      setPickedRun(null); // the runs under the prompt go with it
    }
  }
  function showPeekPrompt(open) {
    setPeekPromptOpen(open);
    if (!open) setPeekSection((s) => (s === "prompt" ? "task" : s));
  }

  // The text the keyboard is on in the panel, also when a text is clicked into: the task's or its
  // prompt's, which takes the highlight off an attachment or a run record. `detailSection` is what
  // the panel shows as such: null while an attachment or a record is chosen, the task's text while
  // the prompt is hidden.
  const selectSection = (area) => {
    setSection(area);
    setFileRel(null);
    setPickedRun(null);
  };
  const detailSection = selectedFile || pickedRecord ? null : promptOpen ? section : "task";

  // The prompt edited under the task's text, in the panel or the preview, its prompt.txt: typing
  // one creates the file, a blank one deletes it (see useTaskFiles.savePrompt). `hook` is the
  // editor's useTaskFiles; the folder is re-read after, so the other one shows the new prompt too.
  async function savePrompt(hook, task, text) {
    if (!(await hook.savePrompt(text))) return;
    setLoads((n) => n + 1);
    showToast(t("toast.saved"));
  }
  const openFile = (file, task = selected) => {
    if (previewKind(file.name)) setPreview({ ...file, space: task.space });
    else window.open(api.fileUrl(task.space, file.rel), "_blank", "noreferrer");
  };

  // One step of the list's selection, for j / k and the wheel. Above the first row there is a
  // "nothing chosen" state: up from the first row drops the selection, as esc does, further up
  // stays there, and down from there comes back to the first row.
  function stepListSelection(name) {
    if (["k", "up"].includes(name) && selectedIndex <= 0) setSelectedKey(null);
    else {
      const move = moveIndex(name, selectedIndex, visible.length);
      if (move >= 0) setSelectedKey(visible[move].key);
    }
  }

  // The wheel over the task list moves the selection, which scrolls itself into view. (The board
  // scrolls as usual.)
  const [scrollEl, setScrollEl] = useState(null);
  useWheelSteps(scrollEl, (dir) => {
    stepListSelection(dir > 0 ? "down" : "up");
    setPane("tasks");
  });

  // Edit a task in the panel: select it, show the panel and put the caret in its text (or, with
  // `area` "prompt", in its prompt, which is shown).
  const openEditor = (task, area = "task") => {
    setSelectedKey(task.key);
    setDetailOpen(true);
    setPane("detail");
    setFocusing({ key: task.key, area });
  };

  async function setStatus(task, status) {
    try {
      const { task: updated } = await api.setStatus(task.space, task.rel, status);
      setSelectedKey(keyOf(task.space, updated.rel)); // keep the task selected in its new place
      await reload();
    } catch (e) {
      showToast(e.message);
    }
  }

  const toggleDone = (task) => setStatus(task, task.status === "done" ? "todo" : "done");
  const togglePending = (task) => setStatus(task, task.status === "pending" ? "todo" : "pending");
  const toggleAbort = (task) => setStatus(task, task.status === "aborted" ? "todo" : "aborted");

  const goTo = (rel) => setSearchParams(rel ? { dir: rel } : {});

  // Into a task's folder, so its subtasks are the list (the board's subtasks button): in the
  // task's own space, since a list of several spaces has no folder of its own.
  function enterTask(task) {
    const { origin: o, work: w, repository: r } = task.space;
    navigate({ pathname: api.spacePath(o, w, r), search: `?${new URLSearchParams({ dir: task.rel })}` });
  }

  // Up one folder, selecting the task we came out of; at the top, over to the tree.
  function goUp() {
    if (data.isRoot) {
      setTreeOpen(true);
      setPane("tree");
      return;
    }
    setSelectedKey(keyOf(space, data.dir));
    goTo(data.parent || "");
  }

  // The text edited in the task panel. A new first line renames the folder; the task stays
  // selected under its new rel unless another one was picked meanwhile.
  async function saveText(task, text) {
    try {
      const {
        task: { rel },
      } = await api.saveTaskText(task.space, task.rel, text);
      const key = keyOf(task.space, rel);
      setSelectedKey((k) => (k === task.key ? key : k));
      // the first line names the folder, so a preview of this task follows the rename
      setPeek((p) => (p && p.key === task.key ? { ...p, key, rel, details: text } : p));
      await reload();
      showToast(t("toast.saved"));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  async function saveEditor(text, files = []) {
    setSaving(true);
    // the new task goes where the editor was opened for: the folder on the right (in a work's
    // list, the work's own tasks), or the folder of the task it is a subtask of
    const { space: inSpace, dir: inDir, status } = creating;
    try {
      const { task: created } = await api.createTaskText(inSpace, inDir, text);
      let rel = created.rel;
      if (status !== "todo") {
        try {
          const { task: updated } = await api.setStatus(inSpace, rel, status);
          rel = updated.rel;
        } catch (e) {
          setCreating(null);
          await reload();
          showToast(e.message, 5000);
          return;
        }
      }
      // the task exists now, so a failed upload must not keep the editor open for a second create
      try {
        for (const f of files) await api.uploadFile(inSpace, rel, f);
      } catch (e) {
        showToast(t("toast.createdUploadFailed", { error: e.message }), 5000);
      }
      setCreating(null);
      setSelectedKey(keyOf(inSpace, rel));
      await reload();
      showToast(t("toast.created"));
    } catch (e) {
      showToast(e.message, 4000);
    } finally {
      setSaving(false);
    }
  }

  // Remove an origin, a work or a repository from taskmgr.json; leave the space on the right when
  // it was in it.
  async function confirmRemove() {
    const { origin: o, work: w, repository: r } = removing;
    const kind = o ? "origin" : r ? "repository" : "work";
    const showing = o
      ? origin === o || (!!work && works.find((x) => x.work === work)?.origin === o)
      : work === w && (!r || repository === r);
    setDeleting(true);
    try {
      setSpaces(o ? await api.deleteOrigin(o) : r ? await api.deleteRepository(w, r) : await api.deleteWork(w));
      setRemoving(null);
      if (showing) navigate("/", { replace: true });
      showToast(t(`${kind}.deleted`));
    } catch (e) {
      showToast(e.message, 4000);
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDelete() {
    if (!confirm) return;
    setDeleting(true);
    try {
      await api.deleteTask(confirm.space, confirm.rel);
      // select the row above the deleted one, as the terminal does
      const i = visible.findIndex((t) => t.key === confirm.key);
      setSelectedKey(visible[Math.max(0, i - 1)]?.key ?? null);
      setConfirm(null);
      if (peek?.key === confirm.key) closePeek(); // deleted from its preview: nothing left to show
      await reload();
      showToast(t("toast.deleted"));
    } catch (e) {
      showToast(e.message, 4000);
    } finally {
      setDeleting(false);
    }
  }

  async function openFolder(task) {
    try {
      await api.openInFileManager(task.space, task.rel);
      showToast(t("toast.opened"));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  async function openSpaceFolder(target) {
    try {
      await api.openSpaceFolder(target);
      showToast(t("toast.opened"));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  async function createSpaceFolder() {
    try {
      setSpaces(await api.createSpaceFolder(space));
      await load();
      showToast(t("toast.folderCreated"));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  // A row dragged to a new place in the tree (see SpaceTree): { kind: "origin", origin }, { kind:
  // "work", work } or { kind: "repository", work, name }, with `before` the name of the sibling it
  // goes before (null: last).
  async function moveSpace({ kind, origin, work, name, before }) {
    try {
      if (kind === "origin") setSpaces(await api.moveOrigin(origin, before));
      else if (kind === "work") setSpaces(await api.moveWork(work, before));
      else setSpaces(await api.moveRepository(work, name, before));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  function runCommand(raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    if (cmd === "h" || cmd === "help") setHelp(true);
    // a page cannot close its own tab, so quitting means logging out
    else if (cmd === "q" || cmd === "quit") logout();
    else showToast(t("toast.notCommand", { cmd }));
  }

  // An origin, or a work without a tasks folder of its own, has nowhere to add to.
  const workRoot = (works || []).find((w) => w.work === work)?.root;
  const canAdd = !!space && !loadError && (!!repository || !!workRoot);

  // Open the new task editor: for a subtask of `parent` (in its folder, in its space), by default
  // the selected task, or, with none selected, for a task in the folder on the right.
  function openCreator(status = "todo", parent = selected) {
    if (parent) setCreating({ space: parent.space, dir: parent.rel, status, parent });
    else if (canAdd) setCreating({ space, dir, status, parent: null });
  }

  function toggleView() {
    const next = view === "board" ? "list" : "board";
    setView(next);
    setPane(next === "board" ? (selected ? boardStatus(selected) : boardStatuses[0]) : "tasks");
  }

  const boardPane = boardStatuses.includes(pane) ? pane : selected ? boardStatus(selected) : boardStatuses[0];

  function selectBoardColumn(status, row = 0) {
    const cards = visible.filter((task) => boardStatus(task) === status);
    setPane(status);
    setSelectedKey(cards[Math.min(row, cards.length - 1)]?.key ?? null);
  }

  function moveBoardColumn(step) {
    const areas = ["tree", ...boardStatuses, "detail"];
    const current = ["tree", "detail"].includes(pane) ? pane : boardPane;
    const target = areas[Math.max(0, Math.min(areas.length - 1, areas.indexOf(current) + step))];
    if (target === current) return;
    if (target === "tree") {
      setTreeOpen(true);
      setPane("tree");
      return;
    }
    if (target === "detail") {
      setDetailOpen(true);
      setPane("detail");
      return;
    }
    const cards = visible.filter((task) => boardStatus(task) === boardPane);
    const row = Math.max(
      0,
      cards.findIndex((task) => task.key === selectedKey),
    );
    selectBoardColumn(target, row);
  }

  function moveListPane(step) {
    const areas = ["tree", "tasks", "detail"];
    const current = areas.includes(pane) ? pane : "tasks";
    const target = areas[Math.max(0, Math.min(areas.length - 1, areas.indexOf(current) + step))];
    if (target === current) return;
    if (target === "tree") setTreeOpen(true);
    if (target === "detail") {
      setDetailOpen(true);
    }
    setPane(target);
  }

  function toggleTreePane() {
    const next = !treeOpen;
    setTreeOpen(next);
    if (!next && pane === "tree") setPane(view === "board" ? boardPane : "tasks");
  }

  function toggleDetailPane(focusWhenOpening = true) {
    const next = !detailOpen;
    setDetailOpen(next);
    if (next) {
      if (focusWhenOpening) setPane("detail");
    } else if (pane === "detail") setPane(view === "board" ? boardPane : "tasks");
  }

  useEffect(() => {
    const onLayoutKeyDown = (e) => {
      if (e.defaultPrevented || e.repeat || (e.code !== "KeyB" && e.key.toLowerCase() !== "b")) return;
      if (e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        toggleDetailPane(false);
      } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleTreePane();
      }
    };
    document.addEventListener("keydown", onLayoutKeyDown);
    return () => document.removeEventListener("keydown", onLayoutKeyDown);
  });

  // cmd+c (ctrl+c elsewhere) with a task selected copies its id as `tm run` takes it,
  // "repository:202610241655" or "work:202610241655", and says so. The browser keeps the key while
  // text is selected or a text field has the caret, so copying text still works, and the modals
  // keep it too. The toast is red when the name before the colon is one `tm run` cannot tell
  // apart (see ambiguousRunNames): the id copied all the same, so the user knows to say which.
  const ambiguousNames = useMemo(() => ambiguousRunNames(works), [works]);
  useEffect(() => {
    const onCopyKeyDown = (e) => {
      if (e.defaultPrevented || e.repeat || (e.code !== "KeyC" && e.key.toLowerCase() !== "c")) return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || isTyping(e)) return;
      if (!selected || window.getSelection?.()?.toString()) return;
      if (creating || confirm || removingFile || configOpen || editingWork || editingOrigin || adding || editingRepository || analysisOpen || runKey !== null || command !== null) return;
      e.preventDefault();
      const id = runId(selected);
      copyText(id).then((ok) => {
        if (!ok) showToast(t("toast.copyFailed"), 1800, "bottom", "error");
        else if (ambiguousNames.has(runName(selected.space))) showToast(t("toast.copiedAmbiguous", { id, name: runName(selected.space) }), 4000, "bottom", "error");
        else showToast(t("toast.copied", { id }));
      });
    };
    document.addEventListener("keydown", onCopyKeyDown);
    return () => document.removeEventListener("keydown", onCopyKeyDown);
  });

  // On the tree: j / k move through the spaces (the right side follows), l / enter go over to
  // the tasks.
  function treeKey(name) {
    const i = spaces.findIndex((s) => s.to === spaceTo);
    const move = moveIndex(name, i, spaces.length);
    if (move !== null) {
      if (move >= 0) selectSpace(spaces[move].to, true);
      return true;
    }
    if (["l", "right", "enter"].includes(name)) {
      if (view === "board") selectBoardColumn(boardStatuses[0]);
      else setPane("tasks");
      return true;
    }
    return false;
  }

  // The terminal's key bindings (see cli.js); :h lists them.
  useShortcuts((name) => {
    if (
      creating ||
      confirm ||
      removingFile ||
      configOpen ||
      editingWork ||
      editingOrigin ||
      adding ||
      editingRepository ||
      analysisOpen ||
      command !== null
    )
      return false;
    if (runKey !== null) {
      // The run dialog: space and q close it, as they close a file's preview; j / k step to the
      // next / previous record of the task while one is shown (not while a run is).
      if (runFolder && savedRuns.length) {
        const move = moveIndex(name, savedRuns.findIndex((r) => r.folder === runFolder), savedRuns.length);
        if (move !== null) {
          if (savedRuns[move].folder !== runFolder) openRun(runTask, savedRuns[move].folder);
          return true;
        }
      }
      if (!["q", "space"].includes(name)) return false;
      closeRun();
      return true;
    }
    if (preview) {
      // j / k step to the next / previous file of the task the preview came from
      const list = (peek ? peekFiles : fileList).filter((f) => previewKind(f.name));
      const move = moveIndex(name, list.findIndex((f) => f.rel === preview.rel), list.length);
      if (move !== null) {
        if (move >= 0 && list[move].rel !== preview.rel) {
          const file = list[move];
          setPreview({ ...file, space: preview.space });
          (peek ? setPeekFileRel : setFileRel)(file.rel);
        }
        return true;
      }
      // e / i edit a text file, as they edit the task's text in its preview
      if (["e", "i"].includes(name) && previewKind(preview.name) === "text") {
        setPreviewEditing(true);
        return true;
      }
      if (name === "d" && deletePreviewFile) {
        deletePreviewFile();
        return true;
      }
      if (!["q", "enter", "space"].includes(name)) return false;
      closePreview();
      return true;
    }
    if (peek) {
      // j / k walk the task's text, its prompt (when shown) and then the attachments; the preview
      // opens with nothing chosen, so the first j lands on the task's text. e / i edit the text
      // chosen (the task's, with none or an attachment chosen); enter opens the attachment chosen,
      // and otherwise closes the preview, as q and space do.
      const rows = ["task", ...(peekPromptOpen ? ["prompt"] : []), ...peekFiles.map((f) => f.rel)];
      const at = peekFile ? rows.indexOf(peekFile.rel) : rows.indexOf(peekSection); // -1 with nothing chosen
      const move = moveIndex(name, at, rows.length);
      if (move !== null) {
        if (move >= 0) {
          const row = rows[move];
          if (row === "task" || row === "prompt") {
            setPeekSection(row);
            setPeekFileRel(null);
          } else setPeekFileRel(row);
        }
        return true;
      }
      const text = peekFile ? null : peekSection; // the text chosen, when not an attachment (null before j / k chose one)
      if (["e", "i"].includes(name)) {
        setPeekEditing(text || "task");
        return true;
      }
      if (name === "d") {
        // the chosen attachment or prompt (nothing to delete without a prompt.txt), else the task
        // itself; each asks first
        if (peekFile) deleteFile(peekAttachments, peekFiles, peekFile, setPeekFileRel);
        else if (text === "prompt") {
          if (peekAttachments.prompt != null) deletePrompt(peekAttachments, peekTask, () => showPeekPrompt(false));
        } else setConfirm(peekTask);
        return true;
      }
      if (["enter", "space"].includes(name) && peekFile) {
        openFile(peekFile, peek);
        return true;
      }
      if (name === "o") {
        openFolder(peekTask);
        return true;
      }
      if (!["q", "enter", "space"].includes(name)) return false;
      closePeek();
      return true;
    }
    // the help closes with the keys that close it in the terminal
    if (help) {
      if (!["q", "enter", "space"].includes(name)) return false;
      setHelp(false);
      return true;
    }
    // cmd+down goes into the selected task (its subtasks are the list), cmd+up back out to the
    // folder above, as in the Finder; at the top cmd+up does nothing.
    if (name === "cmd+down") {
      if (selected && pane !== "tree") enterTask(selected);
      return true;
    }
    if (name === "cmd+up") {
      if (!data.isRoot) goUp();
      return true;
    }
    if (name === "Tab") {
      if (pane !== "tree") {
        setTreeOpen(true);
        setPane("tree");
      } else if (view === "board") selectBoardColumn(boardStatuses[0]);
      else setPane("tasks");
      return true;
    }
    if (name === "/") {
      searchRef.current?.focus();
      return true;
    }
    if (name === "r") {
      reload();
      return true;
    }
    if (name === "v") {
      toggleView();
      return true;
    }
    if (name === ":") {
      setCommand("");
      return true;
    }
    if (["a", "n"].includes(name)) {
      openCreator(view === "board" && boardStatuses.includes(pane) ? pane : "todo");
      return true;
    }
    // esc drops the selection, so the next a / n adds a task at the top, not a subtask
    if (name === "escape" && selected && pane !== "detail") {
      setSelectedKey(null);
      return true;
    }
    if (view === "list" && ["h", "left", "l", "right"].includes(name)) {
      moveListPane(["h", "left"].includes(name) ? -1 : 1);
      return true;
    }
    if (pane === "tree") return treeKey(name);

    if (pane === "detail") {
      // j / k walk the attachments; with the prompt shown, the task's text first, then its prompt
      // and the run records listed under it last, as the panel shows them, so the keyboard moves
      // from the text (where enter, e and i put the caret) down through the attachments to the
      // prompt and its runs. The highlight starts on the task's text then, else on nothing.
      const runRows = promptOpen && selected ? attachments.runs.map((r) => `run:${r.folder}`) : [];
      const rows = promptOpen && selected ? ["task", ...fileList.map((f) => f.rel), "prompt", ...runRows] : fileList.map((f) => f.rel);
      const at = selectedFile ? rows.indexOf(selectedFile.rel) : pickedRecord ? rows.indexOf(`run:${pickedRecord.folder}`) : promptOpen && selected ? rows.indexOf(section) : -1;
      const move = moveIndex(name, at, rows.length);
      if (move !== null) {
        if (move >= 0) {
          const row = rows[move];
          if (row === "task" || row === "prompt") selectSection(row);
          else if (row.startsWith("run:")) selectRun(row.slice(4));
          else selectFile(row);
        }
        return true;
      }
      if (selectedFile) {
        if (["space", "enter"].includes(name)) {
          openFile(selectedFile);
          return true;
        }
        if (name === "d") {
          deleteFile(attachments, fileList, selectedFile, setFileRel);
          return true;
        }
        if (name === "escape") {
          setFileRel(null);
          return true;
        }
      } else if (pickedRecord) {
        // the record chosen: space / enter show it in the run dialog (space closes it again), d removes it
        if (["space", "enter"].includes(name)) {
          openRun(selected, pickedRecord.folder);
          return true;
        }
        if (name === "d") {
          forgetRecord(pickedRecord);
          return true;
        }
        if (name === "escape") {
          setPickedRun(null);
          return true;
        }
      } else {
        if (["enter", "e", "i"].includes(name)) {
          if (selected) openEditor(selected, detailSection);
          return true;
        }
        if (name === "space") return true; // the preview is for the list; here nothing is chosen to open
        if (name === "d" && detailSection === "prompt") {
          // the prompt, not the task; nothing to delete without a prompt.txt
          if (selected && attachments.prompt != null) deletePrompt(attachments, selected, () => showPrompt(false));
          return true;
        }
      }
    }

    if (view === "board" && ["h", "left", "l", "right"].includes(name)) {
      moveBoardColumn(["h", "left"].includes(name) ? -1 : 1);
      return true;
    }
    if (view === "board" && boardStatuses.includes(pane) && name === "i") {
      openCreator(pane);
      return true;
    }
    const movable = view === "board" ? visible.filter((task) => boardStatus(task) === boardPane) : visible;
    const moveFrom = view === "board" ? movable.findIndex((task) => task.key === selectedKey) : selectedIndex;
    const move = moveIndex(name, moveFrom, movable.length);
    if (move !== null) {
      if (view === "list") stepListSelection(name); // with the "nothing chosen" state above the first row
      else if (move >= 0) setSelectedKey(movable[move].key);
      return true;
    }
    const t = selected;
    switch (name) {
      case "e":
      case "i":
        if (t) openEditor(t);
        return true;
      case "space":
        if (t) setPeek(t);
        return true;
      case "enter":
        if (t) {
          if (view === "list") openEditor(t);
          else openFolder(t);
        }
        return true;
      case "o":
        // the selected task's folder, in the list, the progress view and the Task panel alike
        if (t) openFolder(t);
        return true;
      case "x":
        if (t) toggleDone(t);
        return true;
      case "p":
        if (t) togglePending(t);
        return true;
      case "w":
        if (t) toggleAbort(t);
        return true;
      case "d":
        if (t) setConfirm(t);
        return true;
      default:
        return false;
    }
  });

  const c = data.counts;
  const crumbClass = (active) => `${styles.crumb}${active ? ` ${styles.crumbActive}` : ""}`;

  let content;
  if (missing) {
    content = (
      <div className={styles.state}>
        <p className="muted">
          {t("home.folderNotFound")}{" "}
          <button type="button" className={styles.createFolder} onClick={createSpaceFolder}>
            ({t("home.createFolder")})
          </button>
        </p>
        <p className={`mono ${styles.missingPath}`}>{missing.root}</p>
      </div>
    );
  } else if (loadError) {
    content = (
      <div className={styles.state}>
        <p className={styles.error}>{loadError}</p>
        <button type="button" className="btn" onClick={load}>
          {t("common.retry")}
        </button>
      </div>
    );
  } else if (view === "board" && !(loading && data.tasks.length === 0)) {
    // The board keeps its todo / done / pending columns (and the aborted column while aborted tasks
    // are shown) even with no tasks (or none matching).
    content = (
      <TaskBoard
        tasks={visible}
        statuses={boardStatuses}
        selectedKey={selected?.key}
        focusedStatus={boardStatuses.includes(pane) ? pane : null}
        onFocusStatus={setPane}
        onSelect={(t) => {
          setPane(boardStatus(t));
          setSelectedKey(t.key);
        }}
        onPreview={setPeek}
        onMove={setStatus}
        onSubtasks={enterTask}
      />
    );
  } else {
    // The list keeps its column header even with no tasks (or none matching); the message for
    // that sits under the header.
    let empty = null;
    if (data.tasks.length === 0) {
      empty = loading ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <>
          <p className="muted">{data.isRoot ? t("home.noTasks") : t("home.noSubtasks")}</p>
          {canAdd && (
            <button type="button" className="btn" onClick={() => openCreator()}>
              <PlusIcon />
              {t("header.newTask")}
            </button>
          )}
        </>
      );
    } else if (visible.length === 0) {
      // every task here has a status that is not shown: named when it is one status, else "hidden"
      const hidden = [!showDone && "onlyDone", !showPending && "onlyPending", !showAbort && "onlyAbort"].filter(Boolean);
      empty = (
        <p className="muted">
          {query.trim() ? t("home.noMatch", { query }) : t(hidden.length === 1 ? `home.${hidden[0]}` : "home.onlyHidden")}
        </p>
      );
    }
    content = (
      <div className={styles.scroll} ref={setScrollEl}>
        <TaskList
          tasks={visible}
          selectedKey={selected?.key}
          focused={pane === "tasks"}
          onSelect={(t) => setSelectedKey(t.key)}
          onPreview={setPeek}
          onToggleDone={toggleDone}
          empty={empty}
        />
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1 className={styles.title}>
            <Link to={api.allPath} className={styles.titleLink}>
              taskmgr
            </Link>
          </h1>
        </div>

        <div className={styles.search}>
          <SearchIcon className={styles.searchIcon} />
          <input
            ref={searchRef}
            className={`input ${styles.searchInput}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.currentTarget.blur();
              if (pane !== "tree") {
                const selectedTask = tasks.find((task) => task.key === selectedKey);
                const status = selectedTask
                  ? boardStatus(selectedTask)
                  : boardStatuses.includes(pane)
                    ? pane
                    : boardStatuses[0];
                setPane(view === "board" ? status : "tasks");
              }
            }}
            placeholder={t("header.filter")}
            aria-label={t("header.filterLabel")}
          />
          {query && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setQuery("")}
              aria-label={t("header.clearFilter")}
            >
              <XIcon />
            </button>
          )}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className="btn"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleView}
            title={t(view === "board" ? "header.listView" : "header.boardView")}
            aria-label={t(view === "board" ? "header.listView" : "header.boardView")}
          >
            {view === "board" ? <ListIcon /> : <BoardIcon />}
          </button>
          <button type="button" className="btn" onClick={reload} title={t("header.refresh")} aria-label={t("header.refresh")}>
            <RefreshIcon />
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setAnalysisOpen(true)}
            title={t("analysis.title")}
            aria-label={t("analysis.title")}
          >
            <PieIcon />
          </button>
          <div className={styles.account}>
            <LanguageSwitcher />
            <UserMenu />
          </div>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.drawer} data-open={treeOpen} onMouseDown={() => setPane("tree")}>
          <SpaceTree
            works={treeWorks}
            origins={origins}
            error={worksError}
            activeTo={spaceTo}
            focused={pane === "tree"}
            showHidden={showHidden}
            hiddenCount={hiddenCount}
            onShowHidden={setShowHidden}
            onSelect={(to) => selectSpace(to)}
            onEdit={() => setConfigOpen(true)}
            onAdd={setAdding}
            onEditWork={setEditingWork}
            onEditOrigin={setEditingOrigin}
            onEditRepository={setEditingRepository}
            onOpenFolder={openSpaceFolder}
            onDelete={setRemoving}
            onMove={moveSpace}
          />
        </aside>
        {/* The fold bars are never left focused (not in the tab order; the focus is let go after the
            click), so space and enter stay the page's keys. The click takes the focus first, so a
            text being edited in the panel is saved on the blur before the panel folds away. */}
        <button
          type="button"
          className={styles.toggle}
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            toggleTreePane();
          }}
          title={t(treeOpen ? "header.hideTree" : "header.showTree")}
          aria-label={t(treeOpen ? "header.hideTree" : "header.showTree")}
        >
          {treeOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </button>

        {/* a click on the blank area keeps the selection; only esc drops it */}
        <main className={styles.main} onMouseDown={() => setPane("tasks")}>
          {(all || origin || space) && (
            <nav className={styles.section} aria-label={t("header.location")}>
              {(all || origin) && (
                <button
                  type="button"
                  className={crumbClass(!space)}
                  onClick={() => origin && space && selectSpace(api.originPath(origin))}
                  disabled={!space}
                >
                  {all ? t("tree.allOrigins") : origin}
                </button>
              )}
              {space && (
                <span className={styles.crumbItem}>
                  {origin && <span className={styles.crumbSep}>&gt;</span>}
                  <button
                    type="button"
                    className={crumbClass(!repository && data.isRoot)}
                    onClick={() => selectSpace(api.spacePath(origin, work))}
                  >
                    {work}
                  </button>
                </span>
              )}
              {repository && (
                <span className={styles.crumbItem}>
                  <span className={styles.crumbSep}>&gt;</span>
                  <button type="button" className={crumbClass(data.isRoot)} onClick={() => goTo("")}>
                    {repository}
                  </button>
                </span>
              )}
              {data.crumbs.map((cr, i) => {
                const active = i === data.crumbs.length - 1;
                return (
                  <span key={cr.rel} className={styles.crumbItem}>
                    <span className={styles.crumbSep}>&gt;</span>
                    <button type="button" className={crumbClass(active)} onClick={() => goTo(cr.rel)} disabled={active}>
                      {cr.title}
                    </button>
                  </span>
                );
              })}
            </nav>
          )}
          {spaceTo && (
            <div className={styles.listBar}>
              <MonthPicker months={months} index={monthIndex} label={(m) => monthLabel(m.key, t)} onChange={setMonth} />
              {view !== "board" && (
                <>
                  <Checkbox className={styles.showDone} checked={showDone} onChange={setShowDone}>
                    {t("header.showDone")}
                  </Checkbox>
                  <Checkbox className={styles.showDone} checked={showPending} onChange={setShowPending}>
                    {t("header.showPending")}
                  </Checkbox>
                </>
              )}
              <Checkbox className={styles.showDone} checked={showAbort} onChange={setShowAbort}>
                {t("header.showAbort")}
              </Checkbox>
              <button
                type="button"
                className={`btn ${styles.addTask}`}
                onClick={() => openCreator()}
                disabled={!canAdd && !selected}
                title={selected ? t("header.newSubtaskOf", { name: selected.title || selected.id }) : undefined}
              >
                <PlusIcon />
                {t(selected ? "header.newSubtask" : "header.newTask")}
              </button>
            </div>
          )}
          {content}
        </main>

        <button
          type="button"
          className={styles.toggle}
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            toggleDetailPane();
          }}
          title={t(detailOpen ? "header.hideDetails" : "header.showDetails")}
          aria-label={t(detailOpen ? "header.hideDetails" : "header.showDetails")}
        >
          {detailOpen ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
        <aside className={styles.detail} data-open={detailOpen} onMouseDown={() => setPane("detail")} onFocus={() => setPane("detail")}>
          {spaceTo && (
            <TaskPanel
              task={selected}
              focused={pane === "detail"}
              focusKey={focusing?.key}
              focusArea={focusing?.area}
              onFocused={() => setFocusing(null)}
              onSave={saveText}
              onOpenFolder={openFolder}
              onDelete={setConfirm}
              onPreview={(file) => selected && setPreview({ ...file, space: selected.space })}
              onDeleteFile={(file) => deleteFile(attachments, fileList, file, setFileRel)}
              attachments={attachments}
              selectedFile={selectedFile?.rel}
              promptOpen={promptOpen}
              onTogglePrompt={() => showPrompt(!promptOpen)}
              section={detailSection}
              onSection={selectSection}
              onSavePrompt={(task, text) => savePrompt(attachments, task, text)}
              onDeletePrompt={(task) => deletePrompt(attachments, task, () => showPrompt(false))}
              run={selectedRun}
              noRunner={noRunner}
              onRun={openRun}
              selectedRun={pickedRun}
              onForgetRun={forgetRecord}
            />
          )}
        </aside>
      </div>

      <footer className={styles.statusBar}>
        {command !== null ? (
          <CommandLine
            value={command}
            onChange={setCommand}
            onCancel={() => setCommand(null)}
            onRun={() => {
              setCommand(null);
              runCommand(command);
            }}
          />
        ) : (
          <>
            <span>
              {t("status.todo")} {c.todo}
            </span>
            <span>
              {t("status.done")} {c.done}
            </span>
            <span>
              {t("status.pending")} {c.pending}
            </span>
            <span>
              {t("status.aborted")} {c.aborted ?? 0}
            </span>
            <span className={`mono ${styles.path}`} title={data.absDir}>
              {data.absDir}
            </span>
            {syncServer && (
              <span className={`mono ${styles.server}`} title={pollingTitle(polling, t) || syncServer}>
                {syncServer}
                {polling?.on && (
                  <span
                    className="machine-dot"
                    data-state={polling.ok && polling.fresh ? "ok" : "failed"}
                    aria-label={pollingTitle(polling, t)}
                  />
                )}
              </span>
            )}
          </>
        )}
      </footer>

      <ConfigEditorModal
        isOpen={configOpen}
        onClose={() => setConfigOpen(false)}
        onSaved={(d) => {
          setConfigOpen(false);
          setSpaces(d);
          showToast(t("config.saved"));
        }}
      />

      <WorkEditModal
        work={editingWork}
        onClose={() => setEditingWork(null)}
        onSaved={(d, newName) => {
          const oldName = editingWork.work;
          setEditingWork(null);
          setSpaces(d);
          // Follow the rename when the space on the right is this work or one of its repositories.
          if (newName !== oldName && work === oldName)
            navigate(
              { pathname: api.spacePath(editingWork.origin || origin, newName, repository), search: searchParams.toString() },
              { replace: true },
            );
          showToast(t("work.saved"));
        }}
      />

      <WorkEditModal
        origin={editingOrigin}
        onClose={() => setEditingOrigin(null)}
        onSaved={(d, newName) => {
          const oldName = editingOrigin.origin;
          setEditingOrigin(null);
          setSpaces(d);
          // Follow the rename when the origin is the one on the right.
          if (newName !== oldName && origin === oldName)
            navigate(work ? api.spacePath(newName, work, repository) : api.originPath(newName), { replace: true });
          showToast(t("origin.saved"));
        }}
      />

      <AddSpaceModal
        add={adding}
        origins={origins}
        works={works}
        onClose={() => setAdding(null)}
        onSaved={(d, added) => {
          setAdding(null);
          setSpaces(d);
          // Open what was added on the right.
          const to =
            added.type === "origin"
              ? api.originPath(added.name)
              : added.type === "work"
                ? api.spacePath(added.origin, added.name)
                : api.spacePath(d.works.find((item) => item.work === added.work)?.origin || "", added.work, added.name);
          selectSpace(to);
          showToast(t(`${added.type}.added`));
        }}
      />

      <RepositoryEditModal
        repository={editingRepository}
        onClose={() => setEditingRepository(null)}
        onSaved={(d, newName) => {
          const { work: inWork, name } = editingRepository;
          setEditingRepository(null);
          setSpaces(d);
          // Follow a rename when the repository is the one on the right.
          const inOrigin = (works || []).find((item) => item.work === inWork)?.origin || "";
          if (spaceTo === api.spacePath(inOrigin, inWork, name))
            navigate({ pathname: api.spacePath(inOrigin, inWork, newName), search: searchParams.toString() }, { replace: true });
          showToast(t("repository.saved"));
        }}
      />

      <IncomeAnalysisModal isOpen={analysisOpen} works={works} origins={origins} onClose={() => setAnalysisOpen(false)} />

      <HelpModal isOpen={help} onClose={() => setHelp(false)} />

      <TaskEditorModal
        isOpen={!!creating}
        space={creating?.space}
        parent={creating?.parent}
        saving={saving}
        onCancel={() => setCreating(null)}
        onSave={saveEditor}
        onPreview={(file) => setPreview({ ...file, space: creating.space })}
      />

      {/* its brain shows the prompt here on its own, apart from the panel's */}
      <TaskPreviewModal
        task={peekTask}
        editing={peekEditing}
        onEdit={setPeekEditing}
        onEndEdit={() => setPeekEditing(null)}
        onSave={saveText}
        onSavePrompt={(task, text) => savePrompt(peekAttachments, task, text)}
        onOpenFile={(file) => openFile(file, peek)}
        onOpenFolder={openFolder}
        onDelete={setConfirm}
        onDeletePrompt={(task) => deletePrompt(peekAttachments, task, () => showPeekPrompt(false))}
        files={peekFiles}
        selectedRel={peekFile?.rel}
        onClose={closePeek}
        prompt={peekAttachments.prompt}
        promptOpen={peekPromptOpen}
        onTogglePrompt={() => showPeekPrompt(!peekPromptOpen)}
        section={peekFile ? null : peekSection}
      />

      {/* the run of Claude Code on a task, opened by the run button beside its prompt */}
      <RunModal
        task={runTask}
        run={starting ? null : ai.runFor(runTask)}
        saved={savedRuns}
        folder={runFolder}
        onClose={closeRun}
        onStop={ai.stop}
        onAnswer={ai.answer}
      />

      {/* after the task preview, so it stacks in front of it */}
      <FilePreviewModal
        space={preview?.space}
        file={preview}
        editing={previewEditing}
        onEdit={() => setPreviewEditing(true)}
        onEndEdit={() => setPreviewEditing(false)}
        onSaved={() => setLoads((n) => n + 1)}
        onDelete={deletePreviewFile}
        onClose={closePreview}
      />

      <ConfirmModal
        isOpen={!!removingFile}
        title={t(removingFile?.record ? "ai.forgetTitle" : "attach.deleteTitle")}
        message={!removingFile ? "" : removingFile.record ? t("ai.forgetConfirm", { when: formatDateTime(removingFile.record.startedAt) }) : t("attach.deleteConfirm", { name: removingFile.file.name })}
        onCancel={() => setRemovingFile(null)}
        onConfirm={confirmDeleteFile}
      />

      <ConfirmModal
        isOpen={!!confirm}
        title={t("delete.title")}
        message={confirm ? t("delete.message", { name: confirm.title || confirm.id }) : ""}
        busy={deleting}
        onCancel={() => setConfirm(null)}
        onConfirm={confirmDelete}
      />

      <ConfirmModal
        isOpen={!!removing}
        title={t(removing?.origin ? "origin.delete" : removing?.repository ? "repository.delete" : "work.delete")}
        message={
          removing
            ? t(
                removing.origin
                  ? "origin.deleteMessage"
                  : removing.repository
                    ? "repository.deleteMessage"
                    : "work.deleteMessage",
                {
                  name: removing.origin || removing.repository || removing.work,
                },
              )
            : ""
        }
        typeToConfirm={removing?.origin}
        busy={deleting}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      />
    </div>
  );
}

// Vim-style command line in the status bar: enter runs, esc (or backspace on empty) leaves.
function CommandLine({ value, onChange, onCancel, onRun }) {
  const { t } = useTranslation();
  return (
    <span className={`mono ${styles.command}`}>
      :
      <input
        className={styles.commandInput}
        value={value}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onRun();
          } else if (e.key === "Escape" || (e.key === "Backspace" && !value)) {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label={t("home.command")}
      />
    </span>
  );
}
