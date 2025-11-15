import QRCode from 'qrcode';

/**
 * Generate QR code for meeting link
 */
export const generateQRCode = async (text, options = {}) => {
  try {
    const defaultOptions = {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
      ...options,
    };
    
    const dataUrl = await QRCode.toDataURL(text, defaultOptions);
    return dataUrl;
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw error;
  }
};

/**
 * Generate QR code as SVG
 */
export const generateQRCodeSVG = async (text, options = {}) => {
  try {
    const defaultOptions = {
      width: 256,
      margin: 2,
      ...options,
    };
    
    const svg = await QRCode.toString(text, {
      type: 'svg',
      ...defaultOptions,
    });
    return svg;
  } catch (error) {
    console.error('Error generating QR code SVG:', error);
    throw error;
  }
};

