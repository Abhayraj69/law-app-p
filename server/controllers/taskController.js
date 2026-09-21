const TaskService = require('../services/taskService');

/**
 * Task Controller
 * Validation lives in TaskService — see its header comment.
 */

async function listTasks(req, res, next) {
  try {
    const { case_id, status, assigned_to_user_id, task_type } = req.query;
    const tasks = await TaskService.listTasks(req.tenantId, { case_id, status, assigned_to_user_id, task_type });
    res.json({ success: true, data: tasks });
  } catch (err) {
    next(err);
  }
}

async function createTask(req, res, next) {
  try {
    const task = await TaskService.createTask(req.tenantId, req.user, req.body || {});
    res.status(201).json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

async function updateTask(req, res, next) {
  try {
    const task = await TaskService.updateTask(req.tenantId, req.user, req.params.id, req.body || {});
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

async function deleteTask(req, res, next) {
  try {
    const result = await TaskService.deleteTask(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTasks,
  createTask,
  updateTask,
  deleteTask
};
