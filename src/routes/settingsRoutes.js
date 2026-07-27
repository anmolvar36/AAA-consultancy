const express = require('express');
const { 
  getCustomizationSettings, 
  updateCustomizationSettings,
  getLeadStages,
  updateLeadStages,
  getCompanySettings,
  updateCompanySettings,
  getVisaServices,
  updateVisaServices,
  getPackages,
  createPackage,
  updatePackages,
  deletePackage,
  getEmailTemplates,
  updateEmailTemplates,
  getWhatsappTemplates,
  updateWhatsappTemplates
} = require('../controllers/settingsController');
const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.route('/customization')
  .get(getCustomizationSettings)
  .put(authMiddleware, updateCustomizationSettings);

router.route('/lead-stages')
  .get(getLeadStages)
  .put(authMiddleware, updateLeadStages);

router.route('/company')
  .get(getCompanySettings)
  .put(authMiddleware, updateCompanySettings);

router.route('/services')
  .get(getVisaServices)
  .put(authMiddleware, updateVisaServices);

router.route('/packages')
  .get(getPackages)
  .post(authMiddleware, createPackage)
  .put(authMiddleware, updatePackages);

router.route('/packages/:id')
  .delete(authMiddleware, deletePackage);

router.route('/templates/email')
  .get(authMiddleware, getEmailTemplates)
  .put(authMiddleware, updateEmailTemplates);

router.route('/templates/whatsapp')
  .get(authMiddleware, getWhatsappTemplates)
  .put(authMiddleware, updateWhatsappTemplates);

module.exports = router;
