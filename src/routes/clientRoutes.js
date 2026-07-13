const express = require('express');
const { getClients, createClient, updateClientStatus, selectPackage, generateCredentials, clientLogin, changeClientPassword, updateClientDependents } = require('../controllers/clientController');

const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.route('/')
  .get(authMiddleware, getClients)
  .post(authMiddleware, createClient);

router.post('/login', clientLogin);
router.post('/:id/credentials', authMiddleware, generateCredentials);
router.put('/:id/change-password', authMiddleware, changeClientPassword);
router.patch('/:id/status', authMiddleware, updateClientStatus);
router.post('/:id/select-package', authMiddleware, selectPackage);
router.patch('/:id/dependents', authMiddleware, updateClientDependents);


module.exports = router;
