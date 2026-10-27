import * as React from "react";

/** Project-local shadcn-style primitives: owned source, no runtime UI framework. */
type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive";
export function Button({ variant = "default", size = "default", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "default" | "sm" | "icon" }) {
  return <button {...props} className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()} />;
}
export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-card ${className}`.trim()} />;
}
export function CardHeader({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-card-header ${className}`.trim()} />;
}
export function CardContent({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-card-content ${className}`.trim()} />;
}
export function Badge({ variant = "secondary", className = "", ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return <span {...props} className={`ui-badge ui-badge--${variant} ${className}`.trim()} />;
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`ui-input ${props.className || ""}`.trim()} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`ui-input ui-textarea ${props.className || ""}`.trim()} />;
}
