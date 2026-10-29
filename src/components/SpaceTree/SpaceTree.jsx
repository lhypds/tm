import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { EditIcon, FolderIcon, PlusIcon, TrashIcon } from "@components/icons";
import TreeLines from "@components/TreeLines";
import MachineDot from "@components/MachineDot";
import { Checkbox } from "@ui";
import * as api from "@utils/api";
import { formatIncome, formatIncomeShort } from "@utils/income";
import { groupWorksByOrigin } from "@utils/works";
import { useWheelScroll } from "@utils/keys";
import { TASKS_DRAG_TYPE } from "@utils/task";
import styles from "./tree.module.css";

// A small button at the right of a row's name line, shown while the row is hovered.
function RowButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      className={styles.rowEdit}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

// The name line of a row: the name, then its income in short (in 万) at the right end, which the
// buttons replace while the row is hovered.
function Top({ label, income, actions }) {
  const { t } = useTranslation();
  return (
    <div className={styles.top}>
      <span className={styles.name} title={label}>
        {label}
      </span>
      {income && (
        <span className={styles.income} title={formatIncome(income, t)}>
          {formatIncomeShort(income)}
        </span>
      )}
      {actions}
    </div>
  );
}

// Focus from a click shows no ring: a browser counts a held key (Shift for a click) as keyboard
// input and would draw the :focus-visible ring. A key pressed on the element brings it back.
const pointerFocus = {
  onPointerDown: (e) => (e.currentTarget.dataset.pointer = "true"),
  onKeyDown: (e) => delete e.currentTarget.dataset.pointer,
  onBlur: (e) => delete e.currentTarget.dataset.pointer,
};

// One space in the tree. `depth` is 0 for a work without an origin, 1 for a work under its origin
// or a repository of a depth-0 work, and 2 for a repository of a work under an origin.
// `machine` (see MachineDot) is the machine a remote folder was pushed from, shown as a dot after `root`.
// Anything else (`rest`: the drag and drop handlers and data attributes) goes on the row itself.
function Row({ to, exists, hidden, depth, through = [], last, active, focused, label, root, machine, income, actions, onSelect, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      className={styles.row}
      style={{ "--depth": depth }}
      data-depth={depth}
      data-active={active}
      data-focused={active && focused}
      data-missing={!exists}
      data-hidden={!!hidden}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(to)}
      {...pointerFocus}
      {...rest}
    >
      <TreeLines depth={depth} through={through} last={last} />
      <Top label={label} income={income} actions={actions} />
      <div className={`mono ${styles.root}`} title={root}>
        {/* The line is right-to-left so a long path is cut at its start; this keeps the path itself
            left-to-right, or its leading "/" would show at the end. */}
        <bdi dir="ltr">
          {root}
          <MachineDot machine={machine} />
        </bdi>
      </div>
    </div>
  );
}

// An origin's name (and income) at the top of its tree; choosing it (`to`) shows every task of its
// works. "All origins" above the trees is one too, for every task. `rest` goes on the element, as
// for a Row.
function Origin({ name, to, active, focused, income, actions, onSelect, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      className={styles.origin}
      data-active={active}
      data-focused={active && focused}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(to)}
      {...pointerFocus}
      {...rest}
    >
      <Top label={name} income={income} actions={actions} />
    </div>
  );
}

// Whether the pointer is over the top or the bottom half of the element the event is on.
const edgeOf = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY < r.top + r.height / 2 ? "before" : "after";
};

// Where `moved` goes when dropped on the `edge` of `target`, both in `names` (the siblings in
// order): the name of the sibling it goes before, null for last, or undefined when that is where
// it already is.
function placeBefore(names, moved, target, edge) {
  const i = names.indexOf(target);
  const before = edge === "before" ? names[i] : (names[i + 1] ?? null);
  const next = names[names.indexOf(moved) + 1] ?? null;
  return before === moved || before === next ? undefined : before;
}

// Reordering the tree by drag: an origin's name among the origins, a work (with its repositories)
// among the works of its origin, a repository among those of its work. Each level is a list of
// blocks; a block dragged over another of its list goes before or after it, by which half of it
// the pointer is in, and that block shows a line there meanwhile. The hook gives the props to
// spread on a block: `drag(item)` for the element grabbed, `drop(item)` for the block that takes it,
// where `item` is { key, list, name, names, move }: a key unique in the tree, the list it is in (its
// siblings are in the same list, `names` in order) and `move` what `onMove` gets, with `before`
// added on the drop.
function useReorder(onMove) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null); // { key, edge } of the block the line is on

  const done = () => {
    setDrag(null);
    setOver(null);
  };

  const dragProps = (item) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", item.name);
      setDrag(item);
    },
    onDragEnd: done,
  });

  const dropProps = (item) => ({
    "data-dragging": drag?.key === item.key,
    "data-drop": over?.key === item.key ? over.edge : undefined,
    onDragOver: (e) => {
      if (!drag || drag.list !== item.list) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const edge = edgeOf(e);
      const before = placeBefore(drag.names, drag.name, item.name, edge);
      // The same state again keeps the object, so nothing re-renders while the pointer moves.
      setOver((cur) => {
        if (before === undefined) return cur === null ? cur : null;
        return cur?.key === item.key && cur.edge === edge ? cur : { key: item.key, edge };
      });
    },
    onDragLeave: (e) => {
      // Leaving for a child keeps the line; leaving the block drops it. The pointer's place says
      // which, as the element left for (relatedTarget) is not given by every browser.
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) return;
      setOver((cur) => (cur?.key === item.key ? null : cur));
    },
    onDrop: (e) => {
      if (!drag || drag.list !== item.list) return;
      e.preventDefault();
      e.stopPropagation();
      const before = placeBefore(drag.names, drag.name, item.name, edgeOf(e));
      done();
      if (before !== undefined) onMove({ ...drag.move, before });
    },
  });

  return { dragProps, dropProps };
}

// The names of what is in a dropped folder (a directory entry), up to `max`.
async function entryNames(entry, max = 200) {
  const reader = entry.createReader();
  const names = [];
  for (;;) {
    const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length || names.length >= max) return names;
    names.push(...batch.map((x) => x.name));
  }
}

// The folder dragged in from outside the page, as { name, path, git } (`git`: it has a .git), or
// null when it is no folder. A browser does not give a dropped folder's path: it is read from the
// file:// URI some file managers (and editors) add, else the server looks for the folder by its
// name and what is in it, and is "" when not found. The drag data is read before anything awaits,
// as it is gone after the drop event.
async function droppedFolder(dt) {
  const item = [...dt.items].find((x) => x.kind === "file");
  const entry = item?.webkitGetAsEntry?.();
  if (!entry?.isDirectory) return null;
  const uri = (dt.getData("text/uri-list") || "").split(/\r?\n/).find((l) => l.startsWith("file:"));
  const names = await entryNames(entry);
  let path = "";
  if (uri) {
    const u = new URL(uri);
    path = decodeURIComponent(u.pathname).replace(/\/$/, "");
    // file:///C:/a → C:\a, file://host/share → \\host\share
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1).replaceAll("/", "\\");
    else if (u.host) path = `\\\\${u.host}${path.replaceAll("/", "\\")}`;
  } else {
    path = await api
      .locateFolder({ name: entry.name, entries: names.slice(0, 50) })
      .then((r) => r.path)
      .catch(() => "");
  }
  return { name: entry.name, path, git: names.includes(".git") };
}

// "All origins", then the origins as trees, each with its works and their repositories; works
// without an origin come last. `activeTo` is what is shown on the right; `focused` says the keyboard is on the tree rather
// than the task list. `onAdd` opens the add modal with what to start with: { type: "origin" } from
// the head, a work into an origin, a repository into a work. `works` leaves out the hidden ones
// unless `showHidden`; the checkbox under the head (with `hiddenCount`) turns that on and off.
// Dragging reorders (see useReorder): `onMove` gets { kind: "origin", origin }, { kind: "work",
// work } or { kind: "repository", work, name } with `before`, the name of the sibling it now goes
// before (null: last). A folder dropped on the list from outside opens the add modal with the
// folder's name and path: on a work's block, on a repository of that work; elsewhere, on a work,
// into the origin it was dropped in. The path is the source folder when the folder has a .git,
// else the tasks folder. Tasks dragged from the list onto a work or repository row go into it:
// `onMoveTasks(keys, { work, repository })`.
export default function SpaceTree({
  works,
  origins,
  error,
  activeTo,
  focused,
  showHidden,
  hiddenCount,
  onShowHidden,
  onSelect,
  onEdit,
  onAdd,
  onEditWork,
  onEditOrigin,
  onEditRepository,
  onOpenFolder,
  onDelete,
  onMove,
  onMoveTasks,
}) {
  const { t } = useTranslation();
  const groups = groupWorksByOrigin(works, origins);
  const { dragProps, dropProps } = useReorder(onMove);
  const originNames = groups.filter((g) => g.origin).map((g) => g.origin);
  const [listEl, setListEl] = useState(null);
  useWheelScroll(listEl);
  // Where a folder dragged in from outside would go: { origin } or { work }, or null.
  const [fileOver, setFileOver] = useState(null);
  const isFiles = (e) => e.dataTransfer.types.includes("Files");
  const fileTarget = (e) => {
    const work = e.target.closest("[data-work]")?.dataset.work;
    return work ? { work } : { origin: e.target.closest("[data-origin]")?.dataset.origin || "" };
  };
  // Tasks dragged from the list go into the work or repository row they are dropped on (one with a
  // tasks folder): `taskOver` is its key, "work/repository", meanwhile.
  const [taskOver, setTaskOver] = useState(null);
  const isTasks = (e) => e.dataTransfer.types.includes(TASKS_DRAG_TYPE);
  const taskTarget = (e) => {
    const row = e.target.closest("[data-space-work]");
    return row ? { work: row.dataset.spaceWork, repository: row.dataset.spaceRepository || "" } : null;
  };
  const spaceDrop = (work, repository, folder) =>
    folder.root && folder.exists
      ? {
          "data-space-work": work,
          "data-space-repository": repository,
          "data-taskdrop": taskOver === `${work}/${repository}`,
        }
      : {};
  return (
    <div className={styles.panel}>
      <div className={styles.head} data-focused={focused}>
        <span className={styles.title}>{t("tree.origins")}</span>
        <div className={styles.headActions}>
          <button
            type="button"
            className="btn"
            onClick={() => onAdd({ type: "origin" })}
            title={t("add.title")}
            aria-label={t("add.title")}
          >
            <PlusIcon />
          </button>
          <button type="button" className="btn" onClick={onEdit} title={t("config.title")} aria-label={t("config.title")}>
            <EditIcon />
          </button>
        </div>
      </div>
      <Checkbox className={styles.showHidden} checked={showHidden} onChange={onShowHidden}>
        {t("tree.showHidden", { count: hiddenCount })}
      </Checkbox>
      <div
        className={styles.list}
        ref={setListEl}
        onDragOver={(e) => {
          if (isTasks(e)) {
            const to = taskTarget(e);
            setTaskOver(to && `${to.work}/${to.repository}`);
            if (!to) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            return;
          }
          if (!isFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          const to = fileTarget(e);
          setFileOver((cur) => (cur?.work === to.work && cur?.origin === to.origin ? cur : to));
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return;
          setFileOver(null);
          setTaskOver(null);
        }}
        onDrop={async (e) => {
          if (isTasks(e)) {
            e.preventDefault();
            setTaskOver(null);
            const to = taskTarget(e);
            let keys = [];
            try {
              keys = JSON.parse(e.dataTransfer.getData(TASKS_DRAG_TYPE));
            } catch {
              /* not ours after all */
            }
            if (to && keys.length) onMoveTasks(keys, to);
            return;
          }
          if (!isFiles(e)) return;
          e.preventDefault();
          setFileOver(null);
          const to = fileTarget(e);
          const folder = await droppedFolder(e.dataTransfer);
          if (!folder) return;
          const paths = folder.git ? { sourcePath: folder.path } : { tasksPath: folder.path };
          onAdd(
            to.work
              ? { type: "repository", work: to.work, name: folder.name, ...paths }
              : { type: "work", origin: to.origin, name: folder.name, ...paths },
          );
        }}
      >
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : works === null ? (
          <p className={styles.empty}>{t("common.loading")}</p>
        ) : groups.length === 0 ? (
          <p className={styles.empty}>{t("tree.noOrigins")}</p>
        ) : (
          <>
            <div className={styles.group}>
              <Origin
                name={t("tree.allOrigins")}
                to={api.allPath}
                active={activeTo === api.allPath}
                focused={focused}
                onSelect={onSelect}
              />
            </div>
            {groups.map((g) => {
              const base = g.origin ? 1 : 0;
              // A named origin's tree is a block among the origins; the works without one stay last.
              const originItem = g.origin && {
                key: `o:${g.origin}`,
                list: "origins",
                name: g.origin,
                names: originNames,
                move: { kind: "origin", origin: g.origin },
              };
              const workNames = g.works.map((w) => w.work);
              return (
                <div
                  key={g.origin}
                  className={styles.group}
                  data-origin={g.origin}
                  data-filedrop={!!g.origin && fileOver?.origin === g.origin}
                  {...(originItem ? dropProps(originItem) : {})}>
                  {g.origin && (
                    <Origin
                      name={g.origin}
                      to={api.originPath(g.origin)}
                      income={g.income}
                      active={activeTo === api.originPath(g.origin)}
                      focused={focused}
                      onSelect={onSelect}
                      actions={
                        <>
                          <RowButton label={t("add.workInto")} onClick={() => onAdd({ type: "work", origin: g.origin })}>
                            <PlusIcon />
                          </RowButton>
                          <RowButton
                            label={t("origin.edit")}
                            onClick={() => onEditOrigin({ origin: g.origin, income: g.income })}
                          >
                            <EditIcon />
                          </RowButton>
                          <RowButton label={t("origin.delete")} onClick={() => onDelete({ origin: g.origin })}>
                            <TrashIcon />
                          </RowButton>
                        </>
                      }
                      {...dragProps(originItem)}
                    />
                  )}
                  {g.works.map((w, wi) => {
                    const lastWork = wi === g.works.length - 1;
                    const workItem = {
                      key: `w:${w.work}`,
                      list: `works:${g.origin}`,
                      name: w.work,
                      names: workNames,
                      move: { kind: "work", work: w.work },
                    };
                    const repositoryNames = w.repositories.map((p) => p.name);
                    return (
                      // The work and its repositories are one block.
                      <div
                        key={w.work}
                        className={styles.work}
                        data-work={w.work}
                        data-filedrop={fileOver?.work === w.work}
                        {...dropProps(workItem)}
                      >
                        <Row
                          to={api.spacePath(g.origin, w.work)}
                          exists={w.exists}
                          hidden={w.hidden}
                          depth={base}
                          last={lastWork}
                          active={activeTo === api.spacePath(g.origin, w.work)}
                          focused={focused}
                          label={w.work}
                          root={w.remote ? w.machine?.name || t("tree.remote") : w.shownPath}
                          machine={w.remote ? w.machine : null}
                          income={w.income}
                          onSelect={onSelect}
                          actions={
                            <>
                              <RowButton
                                label={t("add.repositoryInto")}
                                onClick={() => onAdd({ type: "repository", work: w.work })}
                              >
                                <PlusIcon />
                              </RowButton>
                              <RowButton label={t("work.edit")} onClick={() => onEditWork(w)}>
                                <EditIcon />
                              </RowButton>
                              {w.root && (
                                <RowButton label={t("tree.openFolder")} onClick={() => onOpenFolder({ work: w.work })}>
                                  <FolderIcon />
                                </RowButton>
                              )}
                              <RowButton label={t("work.delete")} onClick={() => onDelete({ work: w.work })}>
                                <TrashIcon />
                              </RowButton>
                            </>
                          }
                          {...dragProps(workItem)}
                          {...spaceDrop(w.work, "", w)}
                        />
                        {w.repositories.map((p, i) => {
                          const repositoryItem = {
                            key: `r:${w.work}/${p.name}`,
                            list: `repositories:${w.work}`,
                            name: p.name,
                            names: repositoryNames,
                            move: { kind: "repository", work: w.work, name: p.name },
                          };
                          return (
                            <Row
                              key={p.name}
                              to={api.spacePath(g.origin, w.work, p.name)}
                              exists={p.exists}
                              hidden={w.hidden}
                              depth={base + 1}
                              through={g.origin ? [!lastWork] : []}
                              last={i === w.repositories.length - 1}
                              active={activeTo === api.spacePath(g.origin, w.work, p.name)}
                              focused={focused}
                              label={p.name}
                              root={p.remote ? p.machine?.name || t("tree.remote") : p.shownPath}
                              machine={p.remote ? p.machine : null}
                              onSelect={onSelect}
                              actions={
                                <>
                                  <RowButton
                                    label={t("repository.edit")}
                                    onClick={() => onEditRepository({ work: w.work, name: p.name, paths: p.paths })}
                                  >
                                    <EditIcon />
                                  </RowButton>
                                  <RowButton
                                    label={t("tree.openFolder")}
                                    onClick={() => onOpenFolder({ work: w.work, repository: p.name })}
                                  >
                                    <FolderIcon />
                                  </RowButton>
                                  <RowButton
                                    label={t("repository.delete")}
                                    onClick={() => onDelete({ work: w.work, repository: p.name })}
                                  >
                                    <TrashIcon />
                                  </RowButton>
                                </>
                              }
                              {...dragProps(repositoryItem)}
                              {...dropProps(repositoryItem)}
                              {...spaceDrop(w.work, p.name, p)}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
