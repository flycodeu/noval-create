import React from 'react'

interface Props {
  content: React.ReactNode
}

export default function DetailsTab({ content }: Props) {
  return <>{content}</>
}
