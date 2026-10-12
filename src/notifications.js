export function getNotificationState({ supported, permission, secureContext, isIOS, isStandalone, pushSupported = false, serverConfigured = false, pushStatus = "idle" }) {
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
    if (!pushSupported) {
      return {
        code: "limited",
        label: "Open-app only",
        title: "Closed-app reminders are not supported here",
        message: "This browser can show a test notification, but it cannot receive scheduled Web Push messages after Noura closes.",
        action: "Send test notification"
      };
    }

    if (!serverConfigured) {
      return {
        code: "limited",
        label: "Setup needed",
        title: "Closed-app scheduling is not connected yet",
        message: "Noura can show local tests, but its Web Push server still needs to be configured.",
        action: "Check notifications"
      };
    }

    if (pushStatus === "connected") {
      return {
        code: "granted",
        label: "Always on",
        title: "Closed-app reminders are enabled",
        message: "This device is connected to Noura Push and can receive reminders even after the app or browser is closed.",
        action: "Send server test"
      };
    }

    return {
      code: "prompt",
      label: pushStatus === "connecting" ? "Connecting" : "Finish setup",
      title: pushStatus === "error" ? "Push connection needs attention" : "Connect closed-app reminders",
      message: pushStatus === "error" ? "Noura could not register this device. Use the button below to try again." : "Notification permission is ready. Connect this device once to receive scheduled reminders while Noura is closed.",
      action: pushStatus === "connecting" ? "Connecting…" : "Connect reminders"
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
