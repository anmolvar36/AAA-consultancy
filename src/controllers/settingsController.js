let DEFAULT_CUSTOMIZATION = {
  rolesDefinition: [
    { id: 'admin', label: 'Admin (General Manager)' },
    { id: 'operations', label: 'Operations Admin' },
    { id: 'finance', label: 'Finance Officer' },
    { id: 'consultant', label: 'Consultant / Visa Agent' },
    { id: 'marketing', label: 'Marketing Executive' }
  ],
  admin: {
    menus: ['Dashboard', 'Agents', 'Active Cases', 'Doc Verification', 'Finance', 'Closed Cases', 'Clients', 'Leads', 'Social Inbox', 'Marketing', 'Calendar', 'All Agents Performance', 'Integrations'],
    cards: ['Total Clients', 'Today\'s Clients', 'Total Consultations', 'Today\'s Consultations', 'Upcoming Meetings', 'Pending Payments', 'Total Revenue', 'Active Cases', 'Completed Cases', 'Lost Consultations', 'Revenue Today', 'Outstanding Revenue', 'Refunded (50% Rejections)'],
    features: ['canEditTranslationRates']
  },
  operations: {
    menus: ['Dashboard', 'Agents', 'Active Cases', 'Doc Verification', 'Closed Cases', 'Clients', 'Leads', 'Social Inbox', 'Marketing', 'Calendar', 'All Agents Performance'],
    cards: ['Total Clients', 'Today\'s Clients', 'Total Consultations', 'Today\'s Consultations', 'Upcoming Meetings', 'Active Cases', 'Completed Cases'],
    features: []
  },
  finance: {
    menus: ['Dashboard', 'Finance'],
    cards: ['Total Revenue', 'Pending Payments'],
    features: []
  },
  consultant: {
    menus: ['Dashboard', 'Clients', 'Leads', 'Social Inbox', 'Calendar'],
    cards: ['Upcoming Meetings', 'Active Cases'],
    features: []
  },
  marketing: {
    menus: ['Dashboard', 'Leads', 'Marketing'],
    cards: ['Total Consultations', 'Today\'s Consultations'],
    features: []
  },
  documentChecklists: {
    dnv: {
      main: ['Passport (Copy)', 'Employment Verification Letter', 'Remote Income Bank Statements', 'Social Security Certificate'],
      spouse: ['Passport (Copy)', 'Marriage Certificate'],
      minorChild: ['Passport (Copy)', 'Birth Certificate', 'School Enrollment Confirmation'],
      adultChild: ['Passport (Copy)', 'Proof of Financial Dependency', 'Clean Criminal Record Certificate'],
      parent: ['Passport (Copy)', 'Proof of Financial Dependency', 'Medical Insurance Certificate'],
      other: ['Passport (Copy)', 'Relationship Verification Certificate']
    },
    nlv: {
      main: ['Passport (Copy)', 'Spanish Health Insurance Policy', 'Clean Criminal Record Certificate', 'Savings Bank Statements'],
      spouse: ['Passport (Copy)', 'Marriage Certificate'],
      minorChild: ['Passport (Copy)', 'Birth Certificate'],
      adultChild: ['Passport (Copy)', 'Proof of Financial Dependency', 'Clean Criminal Record Certificate'],
      parent: ['Passport (Copy)', 'Proof of Financial Dependency', 'Spanish Health Insurance Policy'],
      other: ['Passport (Copy)', 'Relationship Verification Certificate']
    },
    study: {
      main: ['Passport (Copy)', 'Complutense Admission Letter', 'Medical Certificate', 'Sufficient Funds Guarantee'],
      spouse: ['Passport (Copy)', 'Marriage Certificate'],
      minorChild: ['Passport (Copy)', 'Birth Certificate'],
      adultChild: ['Passport (Copy)', 'Proof of Financial Dependency'],
      parent: ['Passport (Copy)', 'Proof of Financial Dependency'],
      other: ['Passport (Copy)']
    },
    property: {
      main: ['Passport (Copy)', 'Property Purchase Escrow Registry', 'Spanish Bank Account Certificate'],
      spouse: ['Passport (Copy)', 'Marriage Certificate'],
      minorChild: ['Passport (Copy)', 'Birth Certificate'],
      adultChild: ['Passport (Copy)', 'Proof of Financial Dependency'],
      parent: ['Passport (Copy)', 'Proof of Financial Dependency'],
      other: ['Passport (Copy)']
    },
    family: {
      main: ['Passport (Copy)', 'Relationship Verification Certificate', 'Sufficient Income Proof'],
      spouse: ['Passport (Copy)', 'Marriage Certificate'],
      minorChild: ['Passport (Copy)', 'Birth Certificate'],
      adultChild: ['Passport (Copy)', 'Proof of Financial Dependency', 'Clean Criminal Record Certificate'],
      parent: ['Passport (Copy)', 'Proof of Financial Dependency', 'Medical Insurance Certificate'],
      other: ['Passport (Copy)', 'Relationship Verification Certificate']
    }
  },
  flowAutomationSettings: {
    defaultMeetingDuration: 30,
    joinGracePeriod: 10,
    adultAgeThreshold: 18,
    bookingAllowedStart: '09:00',
    bookingAllowedEnd: '18:00',
    welcomeEmailSubject: 'Welcome to AAA Business Consultancy - Your Client Portal is Ready! ✈️',
    welcomeEmailTemplate: `<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; color: #2d3748;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h2 style="color: #4f46e5; margin: 0;">AAA Business Consultancy</h2>
    <p style="color: #718096; font-size: 14px; margin: 4px 0 0;">Relocation & Spain Visa Services</p>
  </div>
  <h3 style="color: #1a202c; border-bottom: 1px solid #edf2f7; padding-bottom: 10px;">Welcome to the Client Portal! 🎉</h3>
  <p>Hello <strong>{client_name}</strong>,</p>
  <p>Congratulations! Your file has been initialized. We have successfully set up your profile and created your Client Portal account.</p>
  
  <p>You can now log in to select your relocation package, complete your payment, and upload your visa documents.</p>
  
  <div style="background-color: #f7fafc; border-left: 4px solid #4f46e5; padding: 16px; margin: 20px 0; border-radius: 4px;">
    <h4 style="margin: 0 0 8px; color: #4f46e5;">Access Credentials</h4>
    <p style="margin: 4px 0;"><strong>Portal URL:</strong> <a href="{portal_url}" style="color: #4f46e5; text-decoration: underline;">Login Here</a></p>
    <p style="margin: 4px 0;"><strong>Username:</strong> {username}</p>
    <p style="margin: 4px 0;"><strong>Temporary Password:</strong> <code style="background-color: #edf2f7; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: #e11d48;">{temp_password}</code></p>
  </div>
  
  <p style="font-size: 13px; color: #e11d48; font-weight: 600;">
    ⚠️ Note: For your security, you will be prompted to change this temporary password immediately upon your first login.
  </p>
  
  <p>If you have any questions, feel free to contact your assigned consultant.</p>
  <p style="font-size: 13px; color: #718096; margin-top: 30px; border-top: 1px solid #edf2f7; padding-top: 10px;">
    This is an automated notification from AAA Visa CRM. Please do not reply directly to this email.
  </p>
</div>`
  }
};

const getCustomizationSettings = async (req, res) => {
  res.json(DEFAULT_CUSTOMIZATION);
};

const updateCustomizationSettings = async (req, res) => {
  try {
    const { settings } = req.body;

    // In a real database, you'd save this to a RolePermissions table.
    // Here we update the in-memory object for demonstration.
    if (settings) {
      DEFAULT_CUSTOMIZATION = { ...DEFAULT_CUSTOMIZATION, ...settings };
    }

    // BROADCAST the change using Socket.io to all affected users
    const io = req.app.get('io');
    if (io && settings) {
      Object.keys(settings).forEach(key => {
        if (key !== 'allowAdminCustomOverrides') {
          console.log(`Emitting permissions_updated to room: role:${key} and user:${key}`);
          io.to(`role:${key}`).emit('permissions_updated', settings[key]);
          io.to(`user:${key}`).emit('permissions_updated', settings[key]);
        }
      });
    }

    res.json({ success: true, message: 'Permissions updated successfully', data: DEFAULT_CUSTOMIZATION });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

let CURRENT_LEAD_STAGES = [
  { id: 'stage_new_lead', name: 'New Lead', type: 'lead', color: '#2196F3', emoji: '🆕' },
  { id: 'stage_hot_lead', name: 'Hot Lead', type: 'lead', color: '#FF9800', emoji: '🔥' },
  { id: 'stage_processing', name: 'Processing', type: 'lead', color: '#3F51B5', emoji: '⚙️' },
  { id: 'stage_under_consultation', name: 'Under Consultation', type: 'lead', color: '#9C27B0', emoji: '📅' },
  { id: 'stage_no_show', name: 'No Show', type: 'lead', color: '#E53E3E', emoji: '🚫' },
  { id: 'stage_waiting_payment', name: 'Waiting for Payment', type: 'client', color: '#FF5722', emoji: '💳' },
  { id: 'stage_documents_pending', name: 'Documents Pending', type: 'client', color: '#E91E63', emoji: '📎' },
  { id: 'stage_under_process', name: 'Under Process', type: 'client', color: '#03A9F4', emoji: '📂' },
  { id: 'stage_completed', name: 'Completed', type: 'client', color: '#4CAF50', emoji: '✅' },
  { id: 'stage_closed', name: 'Closed', type: 'client', color: '#9E9E9E', emoji: '🔒' },
  { id: 'stage_cold_lead', name: 'Cold Lead', type: 'lead', color: '#009688', emoji: '❄️' },
  { id: 'stage_lost_lead', name: 'Lost Lead', type: 'lead', color: '#F44336', emoji: '❌' }
];

const getLeadStages = async (req, res) => {
  try {
    const setting = await prisma.companySetting.findFirst();
    let stages = (setting && setting.leadStages && Array.isArray(setting.leadStages) && setting.leadStages.length > 0)
      ? setting.leadStages
      : CURRENT_LEAD_STAGES;

    // Guarantee 'No Show' is present in stages list
    const hasNoShow = stages.some(s => (s.name || '').toLowerCase() === 'no show' || (s.id || '').toLowerCase() === 'stage_no_show');
    if (!hasNoShow) {
      stages = [
        ...stages,
        { id: 'stage_no_show', name: 'No Show', type: 'lead', color: '#E53E3E', emoji: '🚫' }
      ];
    }

    res.json(stages);
  } catch (error) {
    res.json(CURRENT_LEAD_STAGES);
  }
};

const updateLeadStages = async (req, res) => {
  try {
    const stages = req.body;
    if (Array.isArray(stages)) {
      CURRENT_LEAD_STAGES = stages;
      let setting = await prisma.companySetting.findFirst();
      if (!setting) {
        setting = await prisma.companySetting.create({
          data: { leadStages: stages }
        });
      } else {
        setting = await prisma.companySetting.update({
          where: { id: setting.id },
          data: { leadStages: stages }
        });
      }
      res.json({ success: true, message: 'Stages updated and saved to DB successfully', data: stages });
    } else {
      res.status(400).json({ error: 'Invalid stages format' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getCompanySettings = async (req, res) => {
  try {
    let settings = await prisma.companySetting.findFirst();
    if (!settings) {
      settings = await prisma.companySetting.create({
        data: {}
      });
    }
    res.json(settings);
  } catch (error) {
    console.error('Error fetching company settings:', error);
    res.json({ companyName: 'AAA Business Consultancy LLC', phone: '+971 50 955 4142', email: 'info@aaabusinessconsultancy.com' });
  }
};

const updateCompanySettings = async (req, res) => {
  try {
    const data = req.body;
    let settings = await prisma.companySetting.findFirst();
    if (!settings) {
      settings = await prisma.companySetting.create({ data });
    } else {
      settings = await prisma.companySetting.update({
        where: { id: settings.id },
        data
      });
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getVisaServices = async (req, res) => {
  try {
    let services = await prisma.visaService.findMany();
    if (services.length === 0) {
      const defaultServices = [
        { name: 'Digital Nomad Residency Visa (DNV)', category: 'Residency', basePrice: 3500, active: true },
        { name: 'Non-Lucrative Residency Visa (NLV)', category: 'Residency', basePrice: 3500, active: true },
        { name: 'Spanish Higher Education Student Visa', category: 'Study', basePrice: 1750, active: true },
        { name: 'Golden Visa / Real Estate Investor Residency', category: 'Investment', basePrice: 5000, active: true },
        { name: 'Schengen Short-Stay Tourist Visa', category: 'Schengen', basePrice: 500, active: true }
      ];
      for (const s of defaultServices) {
        await prisma.visaService.create({ data: s });
      }
      services = await prisma.visaService.findMany();
    }
    res.json(services);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateVisaServices = async (req, res) => {
  try {
    const services = req.body;
    for (const s of services) {
      if (s.id && !s.id.startsWith('srv_')) {
        const exists = await prisma.visaService.findUnique({ where: { id: s.id } });
        if (exists) {
          await prisma.visaService.update({
            where: { id: s.id },
            data: {
              name: s.name,
              category: s.category,
              basePrice: s.basePrice,
              active: s.active
            }
          });
        }
      } else {
        await prisma.visaService.create({
          data: {
            name: s.name,
            category: s.category,
            basePrice: s.basePrice,
            active: s.active
          }
        });
      }
    }
    const allServices = await prisma.visaService.findMany();
    res.json(allServices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deduplicatePackages = async () => {
  try {
    const all = await prisma.relocationPackage.findMany();
    const seen = new Map();
    for (const pkg of all) {
      const key = (pkg.code && pkg.code.trim()) ? pkg.code.toLowerCase() : pkg.name.split(':')[0].trim().toUpperCase();
      if (seen.has(key)) {
        const prev = seen.get(key);
        if (pkg.isRecommended && !prev.isRecommended) {
          await prisma.relocationPackage.delete({ where: { id: prev.id } }).catch(() => null);
          seen.set(key, pkg);
        } else {
          await prisma.relocationPackage.delete({ where: { id: pkg.id } }).catch(() => null);
        }
      } else {
        seen.set(key, pkg);
      }
    }
  } catch (e) {
    console.error('Error deduplicating packages:', e);
  }
};

const getPackages = async (req, res) => {
  try {
    await deduplicatePackages();
    let packages = await prisma.relocationPackage.findMany();
    if (packages.length === 0) {
      const defaultPkgs = [
        {
          code: 'full_process',
          name: 'OPTION A: FULL PROCESSING PACKAGE',
          description: 'Complete professional end-to-end support for Spain Residency applications from eligibility to submission.',
          price: 3500,
          additionalApplicantPrice: 500,
          isRecommended: false,
          includes: ['Eligibility & Document Auditing', 'Official Sworn Translation Management', 'Digital Nomad / NLV File Assembly', 'Consulate Appointment Assistance', 'Post-Submission Status Tracking']
        },
        {
          code: 'premium',
          name: 'OPTION B: PREMIUM PACKAGE',
          description: 'Everything in Full Process + complete relocation administrative assistance (NIE/TIE fingerprint appointments, empadronamiento local registration, Social Security, Spanish Bank setup).',
          price: 4750,
          additionalApplicantPrice: 750,
          isRecommended: true,
          includes: ['Everything in Full Processing Package', 'Spanish Bank Account Opening Assistance', 'NIE / TIE Fingerprint Appointment Booking', 'Empadronamiento (Town Hall Registration)', 'Spanish Social Security Registration']
        },
        {
          code: 'relocation',
          name: 'OPTION C: ADMINISTRATIVE RELOCATION PACKAGE',
          description: 'Post-approval administrative relocation support for clients who already have their visa approved and need settlement help in Spain.',
          price: 1750,
          additionalApplicantPrice: 500,
          isRecommended: false,
          includes: ['Post-Approval Residency Card (TIE) Processing', 'Town Hall Registration (Empadronamiento)', 'Spanish Health Card / Private Insurance Setup', 'Driver License Exchange Guidance']
        }
      ];
      for (const p of defaultPkgs) {
        await prisma.relocationPackage.create({ data: p });
      }
      packages = await prisma.relocationPackage.findMany();
    }
    res.json(packages);
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.json([
      { id: 'opt_a', code: 'full_process', name: 'OPTION A: FULL PROCESSING PACKAGE', price: 3500, additionalApplicantPrice: 500, isRecommended: false, isRefundable: true, includes: [] },
      { id: 'opt_b', code: 'premium', name: 'OPTION B: PREMIUM PACKAGE', price: 4750, additionalApplicantPrice: 750, isRecommended: true, isRefundable: true, includes: [] },
      { id: 'opt_c', code: 'relocation', name: 'OPTION C: ADMINISTRATIVE RELOCATION PACKAGE', price: 1750, additionalApplicantPrice: 500, isRecommended: false, isRefundable: false, includes: [] }
    ]);
  }
};

const createPackage = async (req, res) => {
  try {
    const { code, name, description, price, additionalApplicantPrice, isRecommended, isRefundable, includes } = req.body;

    if (isRecommended) {
      await prisma.relocationPackage.updateMany({
        data: { isRecommended: false }
      });
    }

    const created = await prisma.relocationPackage.create({
      data: {
        code: code || `pkg_${Date.now()}`,
        name: name || 'NEW PACKAGE',
        description: description || '',
        price: Number(price) || 0,
        additionalApplicantPrice: Number(additionalApplicantPrice) || 500,
        isRecommended: !!isRecommended,
        isRefundable: !!isRefundable,
        includes: Array.isArray(includes) ? includes : []
      }
    });

    const packages = await prisma.relocationPackage.findMany();
    res.json({ success: true, package: created, packages });
  } catch (error) {
    console.error('Error creating package:', error);
    res.status(500).json({ error: error.message });
  }
};

const deletePackage = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.relocationPackage.delete({
      where: { id }
    });
    const packages = await prisma.relocationPackage.findMany();
    res.json({ success: true, packages });
  } catch (error) {
    console.error('Error deleting package:', error);
    res.status(500).json({ error: error.message });
  }
};

const updatePackages = async (req, res) => {
  try {
    const packagesArr = Array.isArray(req.body) ? req.body : [req.body];

    for (const p of packagesArr) {
      if (p.isRecommended) {
        try {
          await prisma.relocationPackage.updateMany({
            data: { isRecommended: false }
          });
        } catch (e) {
          // Column might not exist in older DB schema
        }
      }

      let existing = null;
      if (p.id && !p.id.startsWith('opt_')) {
        try {
          existing = await prisma.relocationPackage.findUnique({ where: { id: p.id } });
        } catch (e) {
          existing = null;
        }
      }

      if (!existing) {
        const isOptA = (p.code && (p.code.toLowerCase().includes('opt_a') || p.code.toLowerCase().includes('full'))) || (p.name && p.name.toUpperCase().includes('OPTION A'));
        const isOptB = (p.code && (p.code.toLowerCase().includes('opt_b') || p.code.toLowerCase().includes('premium'))) || (p.name && p.name.toUpperCase().includes('OPTION B'));
        const isOptC = (p.code && (p.code.toLowerCase().includes('opt_c') || p.code.toLowerCase().includes('relocation'))) || (p.name && p.name.toUpperCase().includes('OPTION C'));

        try {
          if (isOptA) {
            existing = await prisma.relocationPackage.findFirst({
              where: { OR: [{ code: 'full_process' }, { code: 'opt_a' }, { name: { contains: 'OPTION A' } }] }
            });
          } else if (isOptB) {
            existing = await prisma.relocationPackage.findFirst({
              where: { OR: [{ code: 'premium' }, { code: 'opt_b' }, { name: { contains: 'OPTION B' } }] }
            });
          } else if (isOptC) {
            existing = await prisma.relocationPackage.findFirst({
              where: { OR: [{ code: 'relocation' }, { code: 'opt_c' }, { name: { contains: 'OPTION C' } }] }
            });
          }
        } catch (e) {
          existing = await prisma.relocationPackage.findFirst({
            where: { name: { contains: p.name ? p.name.split(':')[0] : 'OPTION' } }
          }).catch(() => null);
        }
      }

      const dataToSave = {
        name: p.name,
        description: p.description || '',
        price: Number(p.price) || 0,
        includes: Array.isArray(p.includes) ? p.includes : []
      };

      if (p.code) dataToSave.code = p.code;
      if (p.additionalApplicantPrice !== undefined) dataToSave.additionalApplicantPrice = Number(p.additionalApplicantPrice) || 500;
      if (p.isRecommended !== undefined) dataToSave.isRecommended = !!p.isRecommended;
      if (p.isRefundable !== undefined) dataToSave.isRefundable = !!p.isRefundable;

      if (existing) {
        try {
          await prisma.relocationPackage.update({
            where: { id: existing.id },
            data: dataToSave
          });
        } catch (updateErr) {
          delete dataToSave.code;
          delete dataToSave.additionalApplicantPrice;
          delete dataToSave.isRecommended;
          await prisma.relocationPackage.update({
            where: { id: existing.id },
            data: dataToSave
          });
        }
      } else {
        try {
          await prisma.relocationPackage.create({
            data: dataToSave
          });
        } catch (createErr) {
          delete dataToSave.code;
          delete dataToSave.additionalApplicantPrice;
          delete dataToSave.isRecommended;
          await prisma.relocationPackage.create({
            data: dataToSave
          });
        }
      }
    }

    await deduplicatePackages();
    const allPkgs = await prisma.relocationPackage.findMany();
    res.json(allPkgs);
  } catch (error) {
    console.error('Error updating packages:', error);
    res.status(500).json({ error: error.message });
  }
};

const getEmailTemplates = async (req, res) => {
  try {
    const templates = await prisma.template.findMany({
      where: { type: 'email' }
    });
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateEmailTemplates = async (req, res) => {
  try {
    const templates = req.body;
    for (const t of templates) {
      const exists = await prisma.template.findUnique({ where: { id: t.id } });
      if (exists) {
        await prisma.template.update({
          where: { id: t.id },
          data: { subject: t.subject, body: t.body }
        });
      } else {
        await prisma.template.create({
          data: {
            id: t.id,
            type: 'email',
            subject: t.subject,
            body: t.body
          }
        });
      }
    }
    const all = await prisma.template.findMany({ where: { type: 'email' } });
    res.json(all);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getWhatsappTemplates = async (req, res) => {
  try {
    const templates = await prisma.template.findMany({
      where: { type: 'whatsapp' }
    });
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateWhatsappTemplates = async (req, res) => {
  try {
    const templates = req.body;
    for (const t of templates) {
      const exists = await prisma.template.findUnique({ where: { id: t.id } });
      if (exists) {
        await prisma.template.update({
          where: { id: t.id },
          data: { body: t.body }
        });
      } else {
        await prisma.template.create({
          data: {
            id: t.id,
            type: 'whatsapp',
            body: t.body
          }
        });
      }
    }
    const all = await prisma.template.findMany({ where: { type: 'whatsapp' } });
    res.json(all);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getCustomizationSettings,
  updateCustomizationSettings,
  getCustomization: () => DEFAULT_CUSTOMIZATION,
  getLeadStages,
  updateLeadStages,
  getCompanySettings,
  updateCompanySettings,
  getVisaServices,
  updateVisaServices,
  getPackages,
  updatePackages,
  createPackage,
  deletePackage,
  getEmailTemplates,
  updateEmailTemplates,
  getWhatsappTemplates,
  updateWhatsappTemplates
};
