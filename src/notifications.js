export function getNotificationState({ supported, permission, secureContext, isIOS, isStandalone }) {
  if (!secureContext) {
    return {
      code: "unavailable",
      label: "Unavailable",
      title: "A secure connection is required",
      message: "Open the published HTTPS version of Noura to use meal reminders.",
      action: "Notification help"
    };
  }

  if (!supported) {
    return {
      code: "unavailable",
      label: "Unavailable",
      title: "This browser does not support web notifications",
      message: "Try the latest Chrome, Edge, Firefox, or Safari, or install Noura as an app.",
      action: "Notification help"
    };
  }

  if (isIOS && !isStandalone) {
    return {
      code: "install",
      label: "Install first",
      title: "Add Noura to your Home Screen",
      message: "On iPhone and iPad, tap Share → Add to Home Screen, open the installed Noura app, then enable notifications here.",
      action: "How to enable"
    };
  }

  if (permission === "granted") {
    return {
      code: "granted",
      label: "Enabled",
      title: "Notifications are enabled",
      message: "Use the button below to send a test. Keep Noura open or installed for scheduled meal reminders.",
      action: "Send test notification"
    };
  }

  if (permission === "denied") {
    return {
      code: "blocked",
      label: "Blocked",
      title: "Notifications are blocked in your browser",
      message: "Click the site controls icon beside the address, open Site settings, set Notifications to Allow, then reload Noura.",
      action: "Show unblock steps"
    };
  }

  return {
    code: "prompt",
    label: "Not enabled",
    title: "Turn on meal reminders",
    message: "Choose Enable notifications, then select Allow in your browser’s permission prompt. Noura will send a test notification immediately.",
    action: "Enable notifications"
  };
}
