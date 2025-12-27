import { ToastProvider, ToastViewport, ToastComponent } from "./toast";
import { useToast } from "../../hooks/use-toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, variant, ...props }) => (
        <ToastComponent
          key={id}
          id={id}
          title={title}
          description={description}
          variant={variant}
          {...props}
        />
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}

