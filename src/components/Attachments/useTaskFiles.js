import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showToast } from "@ui";
import * as api from "@utils/api";
import { fileRows } from "@utils/task";

const attachmentsOf = (files) => files.filter((f) => !f.isSubtask);

// The attachments of one task folder, loaded while `rel` is set, with upload and delete (remove says
// whether it deleted; asking first is the caller's, the app's delete popup),
// and the task's prompt, its prompt.txt: `prompt` is undefined until the folder is read, null when
// there is no file, else its text; savePrompt(text) writes it (a blank text deletes the file) and
// says whether it did. Also `runs`, the records of the task's runs of Claude Code kept in the folder
// (newest first, each without its transcript, see api.getTask), and forgetRun(folder), which removes one.
// `version` re-reads them when it changes (e.g. after the task list reloads); the files shown stay
// until the fresh ones arrive, so nothing flickers. Another task (by work, repository and rel, not
// by the identity of `space`, which the list remakes) starts from no files.
// `open` holds the rels of the folders opened in the list, toggleDir(rel) opens or closes one, and
// `rows` is the list as shown (see fileRows), which the keyboard walks; another task starts closed.
export default function useTaskFiles(space, rel, version) {
  const [files, setFiles] = useState([]);
  const [prompt, setPrompt] = useState(undefined);
  const [runs, setRuns] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const taskKey = space && rel ? `${space.work}/${space.repository || ""}/${rel}` : null;
  const shown = useRef(null); // the taskKey the files are of

  useEffect(() => {
    if (shown.current !== taskKey) {
      shown.current = taskKey;
      setFiles([]);
      setPrompt(undefined);
      setRuns([]);
      setOpen(new Set());
    }
    if (!taskKey) return;
    let stale = false;
    api
      .getTask(space, rel)
      .then((d) => {
        if (stale) return;
        setFiles(attachmentsOf(d.files));
        setPrompt(d.prompt ?? null);
        setRuns(d.runs || []);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [taskKey, version]); // space and rel are what taskKey is made of

  const add = useCallback(
    async (list) => {
      setUploading(true);
      try {
        let latest;
        for (const f of list) latest = await api.uploadFile(space, rel, f);
        setFiles(attachmentsOf(latest.files));
      } catch (e) {
        showToast(e.message, 4000);
      } finally {
        setUploading(false);
      }
    },
    [space, rel],
  );

  const remove = useCallback(
    async (file) => {
      try {
        const d = await api.deleteFile(space, file.rel);
        setFiles(attachmentsOf(d.files));
        return true;
      } catch (e) {
        showToast(e.message, 4000);
        return false;
      }
    },
    [space],
  );

  const savePrompt = useCallback(
    async (text) => {
      try {
        const d = await api.saveTaskPrompt(space, rel, text);
        // the answer is this task's; by now another one may be shown (the save ran on blur)
        if (shown.current === taskKey) {
          setFiles(attachmentsOf(d.files));
          setPrompt(d.prompt ?? null);
        }
        return true;
      } catch (e) {
        showToast(e.message, 4000);
        return false;
      }
    },
    [space, rel, taskKey],
  );

  const forgetRun = useCallback(
    async (folder) => {
      try {
        await api.deleteSavedRun(space, rel, folder);
        if (shown.current === taskKey) setRuns((prev) => prev.filter((r) => r.folder !== folder));
        return true;
      } catch (e) {
        showToast(e.message, 4000);
        return false;
      }
    },
    [space, rel, taskKey],
  );

  const toggleDir = useCallback(
    (dirRel) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (!next.delete(dirRel)) next.add(dirRel);
        return next;
      }),
    [],
  );
  const rows = useMemo(() => fileRows(files, open), [files, open]);

  return { files, rows, open, toggleDir, prompt, runs, uploading, add, remove, savePrompt, forgetRun };
}
