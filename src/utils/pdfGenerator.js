import PDFDocument from 'pdfkit';
import { numberToWords } from './numberToWords.js';

/**
 * Generates a PDF payslip binary buffer.
 *
 * @param {Object} data Payslip payload data
 * @returns {Promise<Buffer>}
 */
export function generatePayslipPdf(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const buffers = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const {
        organization = {},
        employee = {},
        bank = {},
        payroll = {},
        earnings = [],
        deductions = [],
      } = data;

      const primaryColor = '#1A365D'; // Deep Blue
      const secondaryColor = '#2B6CB0';
      const lightBg = '#EDF2F7';
      const textColor = '#2D3748';

      // ----------------------------------------------------
      // HEADER SECTION
      // ----------------------------------------------------
      doc
        .rect(0, 0, 595.28, 80)
        .fill(primaryColor);

      doc
        .fillColor('#FFFFFF')
        .fontSize(20)
        .font('Helvetica-Bold')
        .text(organization.name || 'HAAZRI HRMS', 40, 25);

      doc
        .fontSize(10)
        .font('Helvetica')
        .text('SALARY PAYSLIP', 400, 28, { align: 'right', width: 155 });

      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const monthStr = monthNames[(payroll.month || 1) - 1] || payroll.month;
      const payPeriodStr = `${monthStr} ${payroll.year || ''}`;

      doc
        .fontSize(9)
        .text(`Pay Period: ${payPeriodStr}`, 400, 42, { align: 'right', width: 155 });

      doc.y = 95;

      // ----------------------------------------------------
      // COMPANY & EMPLOYEE INFO BOX
      // ----------------------------------------------------
      doc
        .rect(40, doc.y, 515.28, 110)
        .fillAndStroke(lightBg, '#CBD5E0');

      const infoTop = doc.y + 10;

      // Left Column: Employee Info
      doc
        .fillColor(primaryColor)
        .fontSize(10)
        .font('Helvetica-Bold')
        .text('EMPLOYEE DETAILS', 50, infoTop);

      doc
        .fillColor(textColor)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Name:', 50, infoTop + 20)
        .font('Helvetica')
        .text(employee.full_name || 'N/A', 130, infoTop + 20);

      doc
        .font('Helvetica-Bold')
        .text('Employee ID:', 50, infoTop + 35)
        .font('Helvetica')
        .text(employee.employee_id || employee.workday_id || 'N/A', 130, infoTop + 35);

      doc
        .font('Helvetica-Bold')
        .text('Designation:', 50, infoTop + 50)
        .font('Helvetica')
        .text(employee.designation || 'N/A', 130, infoTop + 50);

      doc
        .font('Helvetica-Bold')
        .text('Department:', 50, infoTop + 65)
        .font('Helvetica')
        .text(employee.department || 'N/A', 130, infoTop + 65);

      doc
        .font('Helvetica-Bold')
        .text('Email:', 50, infoTop + 80)
        .font('Helvetica')
        .text(employee.email || 'N/A', 130, infoTop + 80);

      // Right Column: Bank & Tax Details
      doc
        .fillColor(primaryColor)
        .fontSize(10)
        .font('Helvetica-Bold')
        .text('BANK & TAX DETAILS', 300, infoTop);

      doc
        .fillColor(textColor)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Bank Name:', 300, infoTop + 20)
        .font('Helvetica')
        .text(bank.bank_name || 'N/A', 390, infoTop + 20);

      doc
        .font('Helvetica-Bold')
        .text('Account No:', 300, infoTop + 35)
        .font('Helvetica')
        .text(bank.masked_account_number || 'N/A', 390, infoTop + 35);

      doc
        .font('Helvetica-Bold')
        .text('IFSC Code:', 300, infoTop + 50)
        .font('Helvetica')
        .text(bank.ifsc_code || 'N/A', 390, infoTop + 50);

      doc
        .font('Helvetica-Bold')
        .text('PAN:', 300, infoTop + 65)
        .font('Helvetica')
        .text(bank.pan_number || 'N/A', 390, infoTop + 65);

      doc
        .font('Helvetica-Bold')
        .text('Payment Date:', 300, infoTop + 80)
        .font('Helvetica')
        .text(payroll.payment_date || 'N/A', 390, infoTop + 80);

      doc.y = infoTop + 120;

      // ----------------------------------------------------
      // ATTENDANCE & DAYS SUMMARY
      // ----------------------------------------------------
      doc
        .rect(40, doc.y, 515.28, 25)
        .fillAndStroke('#E2E8F0', '#CBD5E0');

      const daysY = doc.y + 7;
      doc
        .fillColor(textColor)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text(`Total Working Days: ${payroll.working_days ?? 'N/A'}`, 50, daysY)
        .text(`Paid Days: ${payroll.paid_days ?? 'N/A'}`, 230, daysY)
        .text(`Unpaid Days: ${(payroll.working_days != null && payroll.paid_days != null) ? (payroll.working_days - payroll.paid_days) : 'N/A'}`, 410, daysY);

      doc.y = daysY + 30;

      // ----------------------------------------------------
      // EARNINGS & DEDUCTIONS TABLE
      // ----------------------------------------------------
      const tableTop = doc.y;
      const colWidth = 257.64;

      // Table Header
      doc
        .rect(40, tableTop, colWidth, 22)
        .fillAndStroke(secondaryColor, secondaryColor);
      doc
        .rect(40 + colWidth, tableTop, colWidth, 22)
        .fillAndStroke('#C53030', '#C53030'); // Red tint for deductions

      doc
        .fillColor('#FFFFFF')
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('EARNINGS', 50, tableTop + 6)
        .text('AMOUNT (₹)', 40 + colWidth - 80, tableTop + 6, { align: 'right', width: 70 })
        .text('DEDUCTIONS', 40 + colWidth + 10, tableTop + 6)
        .text('AMOUNT (₹)', 40 + colWidth * 2 - 80, tableTop + 6, { align: 'right', width: 70 });

      let currentY = tableTop + 22;
      const maxRows = Math.max(earnings.length, deductions.length, 1);
      const rowHeight = 20;

      for (let i = 0; i < maxRows; i++) {
        const earn = earnings[i] || {};
        const ded = deductions[i] || {};

        const bg = (i % 2 === 0) ? '#FFFFFF' : '#F7FAFC';
        doc
          .rect(40, currentY, colWidth, rowHeight)
          .fillAndStroke(bg, '#E2E8F0');
        doc
          .rect(40 + colWidth, currentY, colWidth, rowHeight)
          .fillAndStroke(bg, '#E2E8F0');

        doc.fillColor(textColor).font('Helvetica').fontSize(9);

        if (earn.name) {
          doc.text(earn.name, 50, currentY + 5);
          doc.text(Number(earn.amount || 0).toFixed(2), 40 + colWidth - 80, currentY + 5, { align: 'right', width: 70 });
        }

        if (ded.name) {
          doc.text(ded.name, 40 + colWidth + 10, currentY + 5);
          doc.text(Number(ded.amount || 0).toFixed(2), 40 + colWidth * 2 - 80, currentY + 5, { align: 'right', width: 70 });
        }

        currentY += rowHeight;
      }

      // Totals Row
      doc
        .rect(40, currentY, colWidth, 22)
        .fillAndStroke('#EDF2F7', '#CBD5E0');
      doc
        .rect(40 + colWidth, currentY, colWidth, 22)
        .fillAndStroke('#EDF2F7', '#CBD5E0');

      doc
        .fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('TOTAL EARNINGS', 50, currentY + 6)
        .text(`₹ ${Number(payroll.total_earnings || 0).toFixed(2)}`, 40 + colWidth - 100, currentY + 6, { align: 'right', width: 90 })
        .text('TOTAL DEDUCTIONS', 40 + colWidth + 10, currentY + 6)
        .text(`₹ ${Number(payroll.total_deductions || 0).toFixed(2)}`, 40 + colWidth * 2 - 100, currentY + 6, { align: 'right', width: 90 });

      currentY += 35;

      // ----------------------------------------------------
      // NET SALARY BOX & AMOUNT IN WORDS
      // ----------------------------------------------------
      doc
        .rect(40, currentY, 515.28, 45)
        .fillAndStroke('#EBF8FF', '#3182CE');

      const netSalary = Number(payroll.net_salary || 0);
      const amountInWordsStr = payroll.amount_in_words || numberToWords(netSalary);

      doc
        .fillColor(primaryColor)
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('NET TAKE HOME SALARY:', 50, currentY + 10)
        .fontSize(14)
        .text(`₹ ${netSalary.toFixed(2)}`, 350, currentY + 8, { align: 'right', width: 195 });

      doc
        .fillColor(textColor)
        .fontSize(9)
        .font('Helvetica-Oblique')
        .text(amountInWordsStr, 50, currentY + 28, { width: 495 });

      currentY += 65;

      // ----------------------------------------------------
      // FOOTER
      // ----------------------------------------------------
      doc
        .fontSize(8)
        .fillColor('#A0AEC0')
        .font('Helvetica')
        .text('This is a computer-generated payslip generated by Haazri HRMS and does not require a physical signature.', 40, 780, {
          align: 'center',
          width: 515.28,
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
