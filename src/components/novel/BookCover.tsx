import React, { useState } from 'react'
import { isNovelCoverImage } from '../../shared/novel-cover'
import './book-cover.css'

export default function BookCover({ title, image, genre }: { title: string; image?: string | null; genre?: string | null }) {
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const showImage = image && isNovelCoverImage(image) && failedImage !== image
  const tone = [...title].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4
  return <div className={`book-cover book-cover--${tone}`}>
    {showImage ? <img src={image} alt={`${title}的封面`} onError={() => setFailedImage(image)} /> : <div className="book-cover__type" aria-label={`${title}，待添加封面`}><span>{genre || '小说'}</span><strong>{title}</strong><i aria-hidden="true" /></div>}
  </div>
}
