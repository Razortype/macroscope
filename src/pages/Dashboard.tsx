import { useState } from "react";
import TabBar, { type TabId } from "../components/TabBar";
import OverviewTab from "./tabs/OverviewTab";
import FindingsTab from "./tabs/FindingsTab";
import AppsTab from "./tabs/AppsTab";
import FilesTab from "./tabs/FilesTab";
import SecurityTab from "./tabs/SecurityTab";

export default function Dashboard() {
  const [active, setActive] = useState<TabId>("overview");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TabBar active={active} onChange={setActive} counts={{ findings: 0 }} />
      <div style={{ flex: 1, overflow: "auto" }}>
        {active === "overview" && <OverviewTab />}
        {active === "findings" && <FindingsTab />}
        {active === "apps" && <AppsTab />}
        {active === "files" && <FilesTab />}
        {active === "security" && <SecurityTab />}
      </div>
    </div>
  );
}
