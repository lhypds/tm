import { useTranslation } from "react-i18next";
import { formatDateTime } from "@utils/task";

// The dot beside a machine id (see `machine` in GET /api/spaces): green while the machine is in
// touch, i.e. it pushed or polled within the last three minutes, grey otherwise. The tooltip says
// when it was last heard from.
export default function MachineDot({ machine }) {
  const { t } = useTranslation();
  if (!machine) return null;
  const when = machine.seenAt ? formatDateTime(machine.seenAt) : "";
  const title = machine.online
    ? t("tree.machineOnline", { when })
    : machine.seenAt
      ? t("tree.machineOffline", { when })
      : t("tree.machineUnknown");
  return <span className="machine-dot" data-online={!!machine.online} title={title} aria-label={title} />;
}
