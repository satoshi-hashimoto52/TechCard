declare module 'qrcode.react' {
  import * as React from 'react';

  export type QRCodeCanvasProps = React.CanvasHTMLAttributes<HTMLCanvasElement> & {
    value: string;
    size?: number;
    level?: string;
    bgColor?: string;
    fgColor?: string;
    includeMargin?: boolean;
    imageSettings?: {
      src: string;
      height: number;
      width: number;
      excavate: boolean;
      x?: number;
      y?: number;
    };
  };

  export type QRCodeSVGProps = React.SVGProps<SVGSVGElement> & {
    value: string;
    size?: number;
    level?: string;
    bgColor?: string;
    fgColor?: string;
    includeMargin?: boolean;
  };

  export const QRCodeCanvas: React.FC<QRCodeCanvasProps>;
  export const QRCodeSVG: React.FC<QRCodeSVGProps>;
  const QRCode: React.FC<QRCodeCanvasProps | QRCodeSVGProps>;
  export default QRCode;
}
