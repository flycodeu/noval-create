import React from 'react'

interface Props {
  content: React.ReactNode
}

export default function ReviewRoute({ content }: Props) {
  return <>{content}</>
}
