const PDFDocument = require('pdfkit');

/**
 * Generates an official Tax Receipt PDF buffer for a completed payment.
 * 
 * @param {Object} data
 * @param {string} data.paymentId
 * @param {string} data.clientName
 * @param {string} data.clientEmail
 * @param {string} data.serviceType
 * @param {number} data.amount
 * @param {number} data.vatAmount
 * @param {number} data.totalPaid
 * @param {string} data.transactionId
 * @param {Date} [data.paymentDate]
 * @returns {Promise<Buffer>}
 */
const generateReceiptPDF = (data) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const {
        paymentId,
        clientName = 'Valued Client',
        clientEmail = '',
        serviceType = 'Spain Relocation Visa Service',
        amount = 2000,
        vatAmount = 100,
        totalPaid = 2100,
        transactionId = 'TXN-' + Date.now(),
        paymentDate = new Date()
      } = data;

      // Brand Header
      doc.fillColor('#051A3B')
         .fontSize(22)
         .font('Helvetica-Bold')
         .text('AAA BUSINESS CONSULTANCY', 40, 40);

      doc.fontSize(10)
         .font('Helvetica')
         .fillColor('#64748B')
         .text('Spain Relocation Legal & Consulting Services', 40, 68)
         .text('Business Village, Block B, 4th Floor, Office F09, Deira, Dubai, UAE', 40, 82)
         .text('TRN: 105469065400001 | Email: info@aaabusinessconsultancy.com', 40, 96);

      doc.moveTo(40, 115).lineTo(555, 115).strokeColor('#CBD5E1').lineWidth(1).stroke();

      // Title Badge
      doc.rect(40, 130, 515, 30).fill('#051A3B');
      doc.fillColor('#FFFFFF')
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('OFFICIAL PAYMENT RECEIPT', 55, 138);

      // Receipt Metadata
      doc.fillColor('#0F172A').fontSize(10).font('Helvetica-Bold');
      doc.text(`Receipt ID: ${paymentId}`, 40, 175);
      doc.text(`Transaction Ref: ${transactionId}`, 40, 190);

      doc.font('Helvetica').fillColor('#475569');
      doc.text(`Payment Date: ${new Date(paymentDate).toLocaleDateString()}`, 380, 175);
      doc.text(`Payment Status: PAID`, 380, 190);

      // Billed To Box
      doc.rect(40, 215, 515, 45).fill('#F8FAFC');
      doc.fillColor('#051A3B').font('Helvetica-Bold').text('Billed To:', 50, 225);
      doc.fillColor('#334155').font('Helvetica').text(`Client Name: ${clientName}`, 50, 240);
      doc.text(`Email: ${clientEmail}`, 280, 240);

      // Itemized Table Header
      doc.rect(40, 275, 515, 20).fill('#E2E8F0');
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10);
      doc.text('Description', 50, 280);
      doc.text('Qty', 320, 280);
      doc.text('Amount (EUR)', 440, 280);

      // Item Line
      doc.font('Helvetica').fillColor('#334155');
      doc.text(`${serviceType} Package`, 50, 305);
      doc.text('1', 320, 305);
      doc.text(`EUR ${amount.toFixed(2)}`, 440, 305);

      doc.moveTo(40, 330).lineTo(555, 330).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

      // Totals Box
      doc.font('Helvetica').fillColor('#475569');
      doc.text('Base Amount:', 320, 345);
      doc.text(`EUR ${amount.toFixed(2)}`, 440, 345);

      doc.text('UAE VAT (5%):', 320, 360);
      doc.text(`EUR ${vatAmount.toFixed(2)}`, 440, 360);

      doc.moveTo(320, 375).lineTo(555, 375).strokeColor('#CBD5E1').lineWidth(1).stroke();

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#051A3B');
      doc.text('Total Paid:', 320, 385);
      doc.text(`EUR ${totalPaid.toFixed(2)}`, 440, 385);

      // Stamp & Footer
      doc.rect(40, 440, 200, 50).lineWidth(1.5).strokeColor('#10B981').stroke();
      doc.fillColor('#10B981').font('Helvetica-Bold').fontSize(12).text('VERIFIED & PAID', 75, 458);

      doc.fontSize(9).font('Helvetica').fillColor('#94A3B8');
      doc.text('Thank you for choosing AAA Business Consultancy. This document serves as official proof of payment.', 40, 520, { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

module.exports = { generateReceiptPDF };
