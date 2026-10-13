import Swal from 'sweetalert2';

// Toast configuration
const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3500,
  timerProgressBar: true,
  background: '#0f172a',
  color: '#f8fafc',
  didOpen: (toast) => {
    toast.onmouseenter = Swal.stopTimer;
    toast.onmouseleave = Swal.resumeTimer;
  },
  customClass: {
    popup: 'border border-slate-700 shadow-2xl rounded-xl',
  }
});

export const showToast = {
  success: (message: string, title?: string) => {
    return Toast.fire({
      icon: 'success',
      title: title || message,
      text: title ? message : undefined,
    });
  },
  error: (message: string, title?: string) => {
    return Toast.fire({
      icon: 'error',
      title: title || message,
      text: title ? message : undefined,
      timer: 4500,
    });
  },
  warning: (message: string, title?: string) => {
    return Toast.fire({
      icon: 'warning',
      title: title || message,
      text: title ? message : undefined,
    });
  },
  info: (message: string, title?: string) => {
    return Toast.fire({
      icon: 'info',
      title: title || message,
      text: title ? message : undefined,
    });
  },
};

export const toast = showToast;

export const showConfirm = async (
  title: string,
  text: string,
  confirmButtonText: string = 'Sí, continuar'
): Promise<boolean> => {
  const result = await Swal.fire({
    title,
    text,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#475569',
    confirmButtonText,
    cancelButtonText: 'Cancelar',
    background: '#0f172a',
    color: '#f8fafc',
    customClass: {
      popup: 'border border-slate-700 shadow-2xl rounded-2xl',
      confirmButton: 'px-4 py-2 rounded-xl text-xs font-semibold shadow-md',
      cancelButton: 'px-4 py-2 rounded-xl text-xs font-semibold'
    }
  });

  return result.isConfirmed;
};
