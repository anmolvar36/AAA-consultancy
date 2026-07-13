const express = require('express');
const { getAgents, createUser, updateUser, deleteUser, resetUserPassword } = require('../controllers/userController');
const { authMiddleware, rbacMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.route('/')
  .post(authMiddleware, rbacMiddleware(['super_admin', 'admin']), createUser);

router.route('/agents')
  .get(authMiddleware, getAgents);

router.route('/:id')
  .put(authMiddleware, rbacMiddleware(['super_admin', 'admin']), updateUser)
  .delete(authMiddleware, rbacMiddleware(['super_admin', 'admin']), deleteUser);

router.route('/:id/password')
  .put(authMiddleware, rbacMiddleware(['super_admin', 'admin']), resetUserPassword);

module.exports = router;
