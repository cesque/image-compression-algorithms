import { ImageData } from 'canvas'

export interface ImageCompressionAlgorithm {
    compress: (image: ImageData, options: any) => CompressedImage,
    fromBuffer: (data: ArrayBuffer) => CompressedImage,
}

export interface CompressedImage {
    toImageData: () => ImageData,
    toBuffer: () => ArrayBuffer,
}

export { QImg, QImgCompressedImage } from './qimg/QImg'