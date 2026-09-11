/**
 * Converts a numeric amount into Indian Rupee words format.
 * Example: 79700.00 -> "Rupees Seventy-Nine Thousand Seven Hundred Only"
 * Example: 12345.50 -> "Rupees Twelve Thousand Three Hundred Forty-Five and Fifty Paise Only"
 *
 * @param {number|string} amount
 * @returns {string}
 */
export function numberToWords(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num < 0) return 'Rupees Zero Only';
  if (num === 0) return 'Rupees Zero Only';

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
  ];

  const tens = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
  ];

  function convertBelowThousand(n) {
    let str = '';
    if (n >= 100) {
      str += ones[Math.floor(n / 100)] + ' Hundred';
      n %= 100;
      if (n > 0) str += ' ';
    }
    if (n > 0) {
      if (n < 20) {
        str += ones[n];
      } else {
        const t = tens[Math.floor(n / 10)];
        const o = ones[n % 10];
        str += o ? `${t}-${o}` : t;
      }
    }
    return str;
  }

  const integerPart = Math.floor(num);
  const paisePart = Math.round((num - integerPart) * 100);

  let words = '';

  let temp = integerPart;

  const crore = Math.floor(temp / 10000000);
  temp %= 10000000;

  const lakh = Math.floor(temp / 100000);
  temp %= 100000;

  const thousand = Math.floor(temp / 1000);
  temp %= 1000;

  const hundredAndBelow = temp;

  if (crore > 0) {
    words += convertBelowThousand(crore) + ' Crore ';
  }
  if (lakh > 0) {
    words += convertBelowThousand(lakh) + ' Lakh ';
  }
  if (thousand > 0) {
    words += convertBelowThousand(thousand) + ' Thousand ';
  }
  if (hundredAndBelow > 0) {
    words += convertBelowThousand(hundredAndBelow);
  }

  words = words.trim();
  if (!words) words = 'Zero';

  let result = `Rupees ${words}`;

  if (paisePart > 0) {
    result += ` and ${convertBelowThousand(paisePart)} Paise`;
  }

  result += ' Only';
  return result;
}
