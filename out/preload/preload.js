"use strict";
const electron = require("electron");
const api = {
  // 小说管理
  novel: {
    list: (filters) => electron.ipcRenderer.invoke("novel:list", filters),
    get: (id) => electron.ipcRenderer.invoke("novel:get", id),
    create: (data) => electron.ipcRenderer.invoke("novel:create", data),
    update: (id, data) => electron.ipcRenderer.invoke("novel:update", id, data),
    delete: (id) => electron.ipcRenderer.invoke("novel:delete", id),
    export: (id, format) => electron.ipcRenderer.invoke("novel:export", id, format),
    stats: (id) => electron.ipcRenderer.invoke("novel:stats", id)
  },
  // 章节管理
  chapter: {
    list: (novelId) => electron.ipcRenderer.invoke("chapter:list", novelId),
    get: (id) => electron.ipcRenderer.invoke("chapter:get", id),
    create: (novelId, data) => electron.ipcRenderer.invoke("chapter:create", novelId, data),
    update: (id, data) => electron.ipcRenderer.invoke("chapter:update", id, data),
    delete: (id) => electron.ipcRenderer.invoke("chapter:delete", id),
    generateContent: (chapterId) => electron.ipcRenderer.invoke("chapter:generateContent", chapterId),
    generateSummary: (chapterId) => electron.ipcRenderer.invoke("chapter:generateSummary", chapterId),
    aiCheck: (chapterId) => electron.ipcRenderer.invoke("chapter:aiCheck", chapterId)
  },
  // 人物管理
  character: {
    list: (novelId) => electron.ipcRenderer.invoke("character:list", novelId),
    get: (id) => electron.ipcRenderer.invoke("character:get", id),
    create: (novelId, data) => electron.ipcRenderer.invoke("character:create", novelId, data),
    update: (id, data) => electron.ipcRenderer.invoke("character:update", id, data),
    delete: (id) => electron.ipcRenderer.invoke("character:delete", id),
    batchGenerate: (novelId, opts) => electron.ipcRenderer.invoke("character:batchGenerate", novelId, opts),
    generateProtagonist: (novelId, opts) => electron.ipcRenderer.invoke("character:generateProtagonist", novelId, opts),
    getRelations: (novelId) => electron.ipcRenderer.invoke("character:getRelations", novelId),
    generateRelations: (novelId) => electron.ipcRenderer.invoke("character:generateRelations", novelId),
    upsertRelation: (data) => electron.ipcRenderer.invoke("character:upsertRelation", data)
  },
  // 地图管理
  map: {
    getTree: (novelId) => electron.ipcRenderer.invoke("map:getTree", novelId),
    create: (novelId, data) => electron.ipcRenderer.invoke("map:create", novelId, data),
    update: (id, data) => electron.ipcRenderer.invoke("map:update", id, data),
    delete: (id) => electron.ipcRenderer.invoke("map:delete", id),
    batchGenerate: (novelId, structure) => electron.ipcRenderer.invoke("map:batchGenerate", novelId, structure)
  },
  // 大纲管理
  outline: {
    getArcs: (novelId) => electron.ipcRenderer.invoke("outline:getArcs", novelId),
    createArc: (novelId, data) => electron.ipcRenderer.invoke("outline:createArc", novelId, data),
    updateArc: (id, data) => electron.ipcRenderer.invoke("outline:updateArc", id, data),
    deleteArc: (id) => electron.ipcRenderer.invoke("outline:deleteArc", id),
    generateArcs: (novelId) => electron.ipcRenderer.invoke("outline:generateArcs", novelId),
    generateChapterOutlines: (arcId) => electron.ipcRenderer.invoke("outline:generateChapterOutlines", arcId)
  },
  // 模型管理
  model: {
    list: () => electron.ipcRenderer.invoke("model:list"),
    create: (data) => electron.ipcRenderer.invoke("model:create", data),
    update: (id, data) => electron.ipcRenderer.invoke("model:update", id, data),
    delete: (id) => electron.ipcRenderer.invoke("model:delete", id),
    setDefault: (id) => electron.ipcRenderer.invoke("model:setDefault", id),
    test: (id) => electron.ipcRenderer.invoke("model:test", id)
  },
  // 模板管理
  template: {
    list: (type) => electron.ipcRenderer.invoke("template:list", type),
    create: (data) => electron.ipcRenderer.invoke("template:create", data),
    update: (id, data) => electron.ipcRenderer.invoke("template:update", id, data),
    delete: (id) => electron.ipcRenderer.invoke("template:delete", id)
  },
  // 任务管理
  task: {
    list: (novelId) => electron.ipcRenderer.invoke("task:list", novelId),
    get: (id) => electron.ipcRenderer.invoke("task:get", id),
    cancel: (id) => electron.ipcRenderer.invoke("task:cancel", id),
    retry: (id) => electron.ipcRenderer.invoke("task:retry", id)
  },
  // AI 功能
  ai: {
    expandBackground: (input) => electron.ipcRenderer.invoke("ai:expandBackground", input),
    generateCharacter: (novelId, opts) => electron.ipcRenderer.invoke("ai:generateCharacter", novelId, opts),
    generateRelations: (novelId) => electron.ipcRenderer.invoke("ai:generateRelations", novelId),
    rewriteParagraph: (data) => electron.ipcRenderer.invoke("ai:rewriteParagraph", data),
    // 抽卡：批量运行提示词
    runPrompt: (data) => electron.ipcRenderer.invoke("ai:runPrompt", data),
    // 内容评分
    scoreContent: (data) => electron.ipcRenderer.invoke("ai:scoreContent", data)
  },
  // 事件监听
  on: (channel, callback) => {
    const validChannels = [
      "task:stream-chunk",
      "task:status-change",
      "task:complete",
      "character:batch-progress"
    ];
    if (validChannels.includes(channel)) {
      const subscription = (_event, ...args) => callback(...args);
      electron.ipcRenderer.on(channel, subscription);
      return () => electron.ipcRenderer.removeListener(channel, subscription);
    }
    return () => {
    };
  },
  off: (channel, callback) => {
    electron.ipcRenderer.removeListener(channel, callback);
  }
};
electron.contextBridge.exposeInMainWorld("electron", api);
