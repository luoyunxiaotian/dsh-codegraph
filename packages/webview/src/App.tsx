import React, { useEffect, useState } from 'react';
import { SetupView } from './components/SetupView.js';
import { TopBar } from './components/TopBar.js';
import { ArchitectureCanvas } from './components/ArchitectureCanvas.js';
import { ProcessFlowCanvas } from './components/ProcessFlowCanvas.js';
import { DrillDownCanvas } from './components/DrillDownCanvas.js';
import { CodeDrawer } from './components/CodeDrawer.js';
import { ProjectScopeDrawer } from './components/ProjectScopeDrawer.js';
import { Toast } from './components/Toast.js';
import { showToast } from './utils/chatBridge.js';
import {
  FullGraphResult,
  ArchetypeType,
  CodeNode,
  DetectedProjectProfile,
} from '../../core/src/types/index.js';

export const App: React.FC = () => {
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('当前工作区');
  const [scopePath, setScopePath] = useState<string>('.');
  const [cacheTime, setCacheTime] = useState<string | null>(null);

  const [graphData, setGraphData] = useState<FullGraphResult | null>(null);
  const [layoutData, setLayoutData] = useState<any>(null);

  const [currentView, setCurrentView] = useState<'architecture' | 'flow' | 'drilldown'>('architecture');
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [activeCodeNode, setActiveCodeNode] = useState<CodeNode | null>(null);

  // 多工程与多端生态范围管理状态
  const [projects, setProjects] = useState<DetectedProjectProfile[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(undefined);
  const [isScopeDrawerOpen, setIsScopeDrawerOpen] = useState<boolean>(false);

  // 初始化检查后端状态与 URL 参数
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const queryWs = searchParams.get('workspace');
    const queryScope = searchParams.get('scope');

    const init = async () => {
      let targetWs = queryWs;
      if (targetWs) {
        setWorkspaceRoot(targetWs);
        try {
          const wsRes = await fetch('/api/workspace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceRoot: targetWs, scopePath: queryScope || '.' }),
          });
          const wsData = await wsRes.json();
          if (wsData.hasCache && wsData.graph) {
            setGraphData(wsData.graph);
            setLayoutData(wsData.layout?.architecture);
            setProjects(wsData.graph.meta?.projects || []);
            setActiveProjectId(wsData.graph.meta?.activeProjectId);
            setIsInitialized(true);
            setCacheTime('已恢复');
            return;
          }
        } catch {}
      }

      try {
        const url = `/api/status${targetWs ? `?workspace=${encodeURIComponent(targetWs)}` : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.workspaceRoot) {
          setWorkspaceRoot(data.workspaceRoot);
        }
        if (data.scopePath && !queryScope) {
          setScopePath(data.scopePath);
        } else if (queryScope) {
          setScopePath(queryScope);
        }
        if (data.projects) {
          setProjects(data.projects);
        }
        if (data.activeProjectId) {
          setActiveProjectId(data.activeProjectId);
        }
        if (data.initialized && data.graph) {
          // 直接装载已有图谱或本地持久化缓存，无需等待重扫
          setGraphData(data.graph);
          setLayoutData(data.layout?.architecture);
          if (data.graph.meta?.projects) {
            setProjects(data.graph.meta.projects);
          }
          setActiveProjectId(data.graph.meta?.activeProjectId);
          setIsInitialized(true);
          if (data.fromCache && data.savedAt) {
            try {
              const date = new Date(data.savedAt);
              const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              setCacheTime(timeStr);
            } catch {
              setCacheTime('已恢复');
            }
          }
        }
      } catch {}
    };

    init();
  }, []);

  // 执行全量扫描
  const handleFullScan = async (
    customScope?: string,
    customWs?: string,
    customSelectedProjectIds?: string[]
  ) => {
    setIsLoading(true);
    const targetWs = customWs || workspaceRoot;
    const targetScope = customScope || scopePath;
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceRoot: targetWs,
          scopePath: targetScope,
          selectedProjectIds: customSelectedProjectIds,
          activeProjectId,
        }),
      });
      const data = await res.json();
      if (data.success && data.graph) {
        setGraphData(data.graph);
        setLayoutData(data.layout?.architecture);
        if (data.graph.meta?.projects) {
          setProjects(data.graph.meta.projects);
        }
        setActiveProjectId(data.graph.meta?.activeProjectId);
        setIsInitialized(true);
        setCacheTime('已同步保存');
        if (customScope) setScopePath(customScope);
        if (customWs) setWorkspaceRoot(customWs);
      } else {
        const errorMsg = data.error || '扫描返回异常';
        showToast(`❌ ${errorMsg}`);
      }
    } catch (err: any) {
      console.error('扫描失败:', err);
      showToast(`❌ 扫描连接失败: ${err.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 执行极速单工程 / 全生态视图切换 (< 15ms 内存切换)
  const handleSwitchProject = async (targetProjectId?: string) => {
    try {
      const res = await fetch('/api/switch-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeProjectId: targetProjectId }),
      });
      const data = await res.json();
      if (data.success && data.graph) {
        setGraphData(data.graph);
        setLayoutData(data.layout?.architecture);
        setActiveProjectId(targetProjectId);
        if (targetProjectId) {
          const p = projects.find((item) => item.id === targetProjectId);
          showToast(`📦 聚焦工程: ${p?.name || targetProjectId}`);
        } else {
          showToast('🌐 切换至全生态协同总览');
        }
      } else {
        showToast(`❌ 切换失败: ${data.error || '未知错误'}`);
      }
    } catch (err: any) {
      console.error('切换子工程视图失败:', err);
      showToast(`❌ 切换连接失败: ${err.message || err}`);
    }
  };

  // 执行增量更新
  const handleIncrementalUpdate = async () => {
    setIsUpdating(true);
    try {
      const res = await fetch('/api/incremental', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.graph) {
        setGraphData(data.graph);
        setLayoutData(data.layout?.architecture);
        setCacheTime('增量已保存');
      } else {
        showToast(`❌ 增量更新失败: ${data.error || '未知错误'}`);
      }
    } catch (err: any) {
      console.error('增量更新失败:', err);
      showToast(`❌ 增量连接失败: ${err.message || err}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // 模块下钻
  const handleDrillDown = (moduleId: string) => {
    setSelectedModuleId(moduleId);
    setCurrentView('drilldown');
  };

  // 点击符号查看源码
  const handleSelectNode = (nodeId: string) => {
    if (graphData && graphData.allNodes[nodeId]) {
      setActiveCodeNode(graphData.allNodes[nodeId]);
    }
  };

  // 原型手动切换
  const handleArchetypeChange = (newArch: ArchetypeType) => {
    if (graphData) {
      setGraphData({
        ...graphData,
        meta: {
          ...graphData.meta,
          archetype: newArch,
        },
      });
    }
  };

  // 尚未初始化时展示待命就绪卡片
  if (!isInitialized || !graphData) {
    return (
      <div className="relative w-full h-full overflow-hidden">
        <SetupView
          workspaceRoot={workspaceRoot}
          onStartScan={handleFullScan}
          isLoading={isLoading}
          hasExistingGraph={!!graphData}
          onCancel={() => setIsInitialized(true)}
        />
        <Toast />
      </div>
    );
  }

  const selectedModule = graphData.architectureView.modules.find((m) => m.id === selectedModuleId);
  const currentProjects = graphData.meta.projects || projects;

  return (
    <div className="flex flex-col h-full w-full bg-dsh-base overflow-hidden">
      {/* 顶部导航控制台 */}
      <TopBar
        projectName={graphData.meta.projectName}
        scopePath={graphData.meta.scopePath}
        currentView={currentView}
        onViewChange={setCurrentView}
        archetype={graphData.meta.archetype}
        isAutoCorrected={graphData.meta.isAutoCorrected}
        healthScore={graphData.meta.archetypeHealth?.score}
        onArchetypeChange={handleArchetypeChange}
        onIncrementalUpdate={handleIncrementalUpdate}
        onFullRescan={() => handleFullScan()}
        onReset={() => setIsInitialized(false)}
        isUpdating={isUpdating}
        selectedModuleName={selectedModule?.name}
        cacheTime={cacheTime}
        languages={graphData.meta.languages}
        projects={currentProjects}
        activeProjectId={graphData.meta.activeProjectId || activeProjectId}
        onSwitchProject={handleSwitchProject}
        onOpenScopeDrawer={() => setIsScopeDrawerOpen(true)}
      />

      {/* 主画布展示区 */}
      <main className="flex-1 relative overflow-hidden">
        {currentView === 'architecture' && (
          <ArchitectureCanvas
            modules={graphData.architectureView.modules}
            buses={graphData.architectureView.buses}
            layout={layoutData}
            onDrillDown={handleDrillDown}
          />
        )}

        {currentView === 'flow' && (
          <ProcessFlowCanvas
            flows={graphData.processFlows}
            onSelectNode={handleSelectNode}
          />
        )}

        {currentView === 'drilldown' && selectedModule && (
          <DrillDownCanvas
            module={selectedModule}
            allNodes={graphData.allNodes}
            allEdges={graphData.allEdges}
            onSelectNode={handleSelectNode}
            onBackToArchitecture={() => setCurrentView('architecture')}
          />
        )}

        {/* 源码预览抽屉 */}
        <CodeDrawer node={activeCodeNode} onClose={() => setActiveCodeNode(null)} />

        {/* 多端与版本范围管理抽屉 */}
        <ProjectScopeDrawer
          isOpen={isScopeDrawerOpen}
          onClose={() => setIsScopeDrawerOpen(false)}
          projects={currentProjects}
          initialSelectedIds={currentProjects.filter((p) => p.isRecommended).map((p) => p.id)}
          onApplyScope={(selectedIds) => {
            setIsScopeDrawerOpen(false);
            handleFullScan(scopePath, workspaceRoot, selectedIds);
          }}
          isLoading={isLoading}
        />
      </main>

      {/* 全局微型气泡提示 */}
      <Toast />
    </div>
  );
};

export default App;
