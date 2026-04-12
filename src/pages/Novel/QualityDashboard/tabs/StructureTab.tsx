import React from 'react'

interface Props {
  content: React.ReactNode
}

export default function StructureTab({ content }: Props) {
  return <>{content}</>
}
