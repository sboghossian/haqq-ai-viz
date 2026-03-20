import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';

const NODE_COLORS = {
  Project: '#a855f7', Package: '#8b5cf6', Module: '#7c3aed',
  Folder: '#6366f1', File: '#3b82f6', Class: '#f59e0b',
  Function: '#10b981', Method: '#14b8a6', Interface: '#ec4899',
  Enum: '#f97316', Variable: '#64748b', Type: '#94a3b8',
  Community: '#818cf8', Process: '#f43f5e', Decorator: '#d946ef',
  Import: '#0ea5e9', CodeElement: '#6b7280', Struct: '#eab308'
};

const NODE_SIZES = {
  Project: 18, Package: 14, Module: 12, Folder: 10,
  File: 5, Class: 8, Function: 4, Method: 3,
  Interface: 7, Enum: 5, Variable: 2, Type: 2,
  Community: 0, Process: 0, Decorator: 3, Import: 2
};

const EDGE_COLORS = {
  CONTAINS: '#1e3a2a', DEFINES: '#0e5a6a', IMPORTS: '#1d3ed8',
  CALLS: '#6d2aed', EXTENDS: '#a23a0c', IMPLEMENTS: '#9e1850',
  HAS_METHOD: '#0e5a6a', MEMBER_OF: '#4a4a6a', STEP_IN_PROCESS: '#8b3a5e',
  OVERRIDES: '#a23a0c', USES: '#4a5568'
};

document.addEventListener('DOMContentLoaded', () => init());
window.addEventListener('load', () => init());

let initialized = false;
async function init() {
  if (initialized) return;
  initialized = true;
  const resp = await fetch('graph.json');
  const data = await resp.json();
  const nodes = data.nodes;
  const edges = data.relationships || data.edges;

  const graph = new Graph({ multi: true, type: 'directed' });
  const hiddenTypes = new Set(['Community', 'Process']);
  const visibleNodes = new Set();

  nodes.forEach(n => {
    if (hiddenTypes.has(n.label)) return;
    const props = n.properties || {};
    visibleNodes.add(n.id);
    graph.addNode(n.id, {
      label: props.name || n.id,
      x: Math.random() * 1000 - 500,
      y: Math.random() * 1000 - 500,
      size: NODE_SIZES[n.label] || 3,
      color: NODE_COLORS[n.label] || '#6b7280',
      nodeType: n.label,
      filePath: props.filePath || '',
      startLine: props.startLine,
    });
  });

  edges.forEach(e => {
    if (visibleNodes.has(e.sourceId) && visibleNodes.has(e.targetId)) {
      try {
        graph.addEdge(e.sourceId, e.targetId, {
          color: EDGE_COLORS[e.type] || '#334155',
          size: Math.max(0.3, (e.confidence || 0.5) * 1.5),
          relationType: e.type,
        });
      } catch (ex) { /* skip duplicate */ }
    }
  });

  // Layout
  const settings = forceAtlas2.inferSettings(graph);
  settings.gravity = 0.05;
  settings.scalingRatio = 3;
  settings.barnesHutOptimize = true;
  forceAtlas2.assign(graph, { iterations: 300, settings });
  noverlap.assign(graph, { maxIterations: 20, ratio: 1.5 });

  // Stats
  const typeCounts = {};
  nodes.forEach(n => { if (!hiddenTypes.has(n.label)) typeCounts[n.label] = (typeCounts[n.label] || 0) + 1; });
  const communityCount = nodes.filter(n => n.label === 'Community').length;
  const processCount = nodes.filter(n => n.label === 'Process').length;

  document.getElementById('stat-nodes').textContent = graph.order;
  document.getElementById('stat-edges').textContent = graph.size;
  document.getElementById('stat-clusters').textContent = communityCount;
  document.getElementById('stat-flows').textContent = processCount;

  // Render
  const container = document.getElementById('sigma-container');
  let highlightedNodes = null;
  const filteredTypes = new Set();

  const renderer = new Sigma(graph, container, {
    renderEdgeLabels: false,
    defaultEdgeType: 'arrow',
    labelColor: { color: '#cbd5e1' },
    labelFont: 'Inter, system-ui, sans-serif',
    labelSize: 12,
    labelRenderedSizeThreshold: 6,
    defaultNodeColor: '#6b7280',
    defaultEdgeColor: '#334155',
    minCameraRatio: 0.02,
    maxCameraRatio: 20,
    nodeReducer: (node, data) => {
      const d = { ...data };
      if (highlightedNodes && highlightedNodes.size > 0) {
        if (!highlightedNodes.has(node)) {
          d.color = '#1e293b';
          d.label = '';
          d.size = d.size * 0.5;
        }
      }
      if (filteredTypes.size > 0 && filteredTypes.has(d.nodeType)) {
        d.hidden = true;
      }
      return d;
    },
    edgeReducer: (edge, data) => {
      const d = { ...data };
      if (highlightedNodes && highlightedNodes.size > 0) {
        const src = graph.source(edge);
        const tgt = graph.target(edge);
        if (!highlightedNodes.has(src) || !highlightedNodes.has(tgt)) {
          d.hidden = true;
        }
      }
      return d;
    }
  });

  // Tooltip
  const tooltip = document.getElementById('tooltip');
  renderer.on('enterNode', ({ node }) => {
    const attrs = graph.getNodeAttributes(node);
    tooltip.querySelector('.tt-name').textContent = attrs.label;
    const typeEl = tooltip.querySelector('.tt-type');
    typeEl.textContent = attrs.nodeType;
    typeEl.style.background = (NODE_COLORS[attrs.nodeType] || '#6b7280') + '33';
    typeEl.style.color = NODE_COLORS[attrs.nodeType] || '#6b7280';
    let detail = '';
    if (attrs.filePath) detail += attrs.filePath;
    if (attrs.startLine) detail += ':' + attrs.startLine;
    const neighbors = graph.neighbors(node);
    detail += '\n' + neighbors.length + ' connections';
    tooltip.querySelector('.tt-detail').textContent = detail;
    tooltip.style.display = 'block';
    container.style.cursor = 'pointer';
  });

  renderer.getMouseCaptor().on('mousemovebody', (e) => {
    tooltip.style.left = (e.original.clientX + 15) + 'px';
    tooltip.style.top = (e.original.clientY + 15) + 'px';
  });

  renderer.on('leaveNode', () => {
    tooltip.style.display = 'none';
    container.style.cursor = 'default';
  });

  // Click: highlight neighborhood
  renderer.on('clickNode', ({ node }) => {
    const neighbors = new Set(graph.neighbors(node));
    neighbors.add(node);
    highlightedNodes = neighbors;
    renderer.refresh();
  });

  renderer.on('clickStage', () => {
    highlightedNodes = null;
    renderer.refresh();
  });

  // Legend
  const legendContainer = document.getElementById('legend-items');
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  sortedTypes.forEach(([type, count]) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = '<span class="legend-dot" style="background:' + (NODE_COLORS[type] || '#6b7280') + '"></span>' + type + '<span class="legend-count">' + count + '</span>';
    item.addEventListener('click', () => {
      if (filteredTypes.has(type)) { filteredTypes.delete(type); item.classList.remove('dimmed'); }
      else { filteredTypes.add(type); item.classList.add('dimmed'); }
      renderer.refresh();
    });
    legendContainer.appendChild(item);
  });

  // Search
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    searchResults.innerHTML = '';
    if (q.length < 2) { searchResults.style.display = 'none'; return; }
    const matches = [];
    graph.forEachNode((id, attrs) => {
      if (attrs.label.toLowerCase().includes(q) || (attrs.filePath || '').toLowerCase().includes(q)) {
        matches.push({ id, ...attrs });
      }
    });
    matches.sort((a, b) => a.label.localeCompare(b.label));
    matches.slice(0, 20).forEach(m => {
      const div = document.createElement('div');
      div.className = 'search-item';
      div.innerHTML = '<span class="search-type">' + m.nodeType + '</span>' + m.label;
      div.addEventListener('click', () => {
        const pos = renderer.getNodeDisplayData(m.id);
        const camera = renderer.getCamera();
        camera.animate({ x: pos.x, y: pos.y, ratio: 0.15 }, { duration: 400 });
        const neighbors = new Set(graph.neighbors(m.id));
        neighbors.add(m.id);
        highlightedNodes = neighbors;
        renderer.refresh();
        searchResults.style.display = 'none';
        searchInput.value = m.label;
      });
      searchResults.appendChild(div);
    });
    searchResults.style.display = matches.length ? 'block' : 'none';
  });

  searchInput.addEventListener('blur', () => { setTimeout(() => searchResults.style.display = 'none', 200); });

  // Controls
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    const c = renderer.getCamera(); c.animate({ ratio: c.getState().ratio / 1.5 }, { duration: 200 });
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    const c = renderer.getCamera(); c.animate({ ratio: c.getState().ratio * 1.5 }, { duration: 200 });
  });
  document.getElementById('btn-fit').addEventListener('click', () => {
    const c = renderer.getCamera(); c.animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 400 });
  });
  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  });

  // Force resize after layout settles
  setTimeout(() => renderer.refresh(), 100);
  window.addEventListener('resize', () => renderer.refresh());
}
