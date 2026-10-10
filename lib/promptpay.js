// lib/promptpay.js
// สร้างข้อความ PromptPay QR (EMVCo) จากเบอร์มือถือ / เลขบัตรประชาชน / e-wallet + ยอดเงิน
// ใช้คู่กับ qrcode.react:  <QRCodeSVG value={promptPayPayload('0812345678', 120)} />

function tlv(id, value) {
  return id + String(value.length).padStart(2, '0') + value;
}

function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function promptPayPayload(target, amount) {
  const t = String(target || '').replace(/\D/g, '');
  let subTag, subVal;
  if (t.length === 13) {
    subTag = '02'; // เลขบัตรประชาชน / เลขผู้เสียภาษี
    subVal = t;
  } else if (t.length === 10 || t.length === 9) {
    subTag = '01'; // เบอร์มือถือ
    subVal = '0066' + t.replace(/^0/, '');
  } else if (t.length === 15) {
    subTag = '03'; // e-wallet
    subVal = t;
  } else {
    throw new Error('PromptPay ID ไม่ถูกต้อง');
  }

  const hasAmount = Number(amount) > 0;
  let payload =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') +
    tlv('29', tlv('00', 'A000000677010111') + tlv(subTag, subVal)) +
    tlv('53', '764') +
    (hasAmount ? tlv('54', Number(amount).toFixed(2)) : '') +
    tlv('58', 'TH');

  payload += '6304';
  return payload + crc16(payload);
}
