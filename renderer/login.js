/**
 * LeadsFlow — Login Logic
 * Auth via Supabase (login, register, Google OAuth).
 */

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  const btnLogin = document.getElementById("btn-login");
  const btnRegister = document.getElementById("btn-register");
  const errorDiv = document.getElementById("login-error");
  const subtitle = document.getElementById("login-subtitle");
  const confirmGroup = document.getElementById("confirm-group");
  const confirmInput = document.getElementById("login-confirm");

  let isRegisterMode = false;

  btnRegister.addEventListener("click", () => {
    isRegisterMode = !isRegisterMode;
    if (isRegisterMode) {
      subtitle.textContent = "Crie sua conta";
      btnLogin.textContent = "Criar conta";
      btnRegister.textContent = "Já tenho conta";
      confirmGroup.style.display = "block";
      confirmInput.required = true;
    } else {
      subtitle.textContent = "Entre na sua conta";
      btnLogin.textContent = "Entrar";
      btnRegister.textContent = "Criar conta gratuita";
      confirmGroup.style.display = "none";
      confirmInput.required = false;
      confirmInput.value = "";
    }
    hideError();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const confirm = confirmInput.value;
    const rememberMe = document.getElementById("remember-me").checked;

    if (!email || !password) { showError("Preencha email e senha."); return; }
    if (password.length < 6) { showError("A senha deve ter pelo menos 6 caracteres."); return; }

    if (isRegisterMode) {
      if (!confirm) { showError("Confirme sua senha."); return; }
      if (password !== confirm) { showError("As senhas não coincidem."); return; }
    }

    hideError();
    setLoading(true);

    try {
      if (isRegisterMode) {
        const result = await window.api.authRegister(email, password, rememberMe);
        if (result.error) {
          showError(result.error);
        } else if (result.needsConfirmation) {
          showSuccess("Conta criada! Verifique seu email para confirmar o cadastro antes de fazer login.");
          isRegisterMode = false;
          subtitle.textContent = "Entre na sua conta";
          btnLogin.textContent = "Entrar";
          btnRegister.textContent = "Criar conta gratuita";
          confirmGroup.style.display = "none";
          confirmInput.required = false;
          confirmInput.value = "";
          document.getElementById("login-password").value = "";
        } else {
          window.api.authSuccess();
        }
      } else {
        const result = await window.api.authLogin(email, password, rememberMe);
        if (result.error) {
          if (result.error.includes("Email not confirmed") || result.error.includes("email_not_confirmed")) {
            showError("Confirme seu email antes de fazer login. Verifique sua caixa de entrada.");
          } else {
            showError(result.error);
          }
        } else {
          window.api.authSuccess();
        }
      }
    } catch (err) {
      showError(err.message || "Erro de conexão.");
    } finally {
      setLoading(false);
    }
  });

  function showError(msg) {
    errorDiv.textContent = msg;
    errorDiv.style.display = "block";
    errorDiv.style.background = "rgba(239, 68, 68, 0.1)";
    errorDiv.style.borderColor = "rgba(239, 68, 68, 0.2)";
    errorDiv.style.color = "#ef4444";
  }

  function showSuccess(msg) {
    errorDiv.textContent = msg;
    errorDiv.style.display = "block";
    errorDiv.style.background = "rgba(34, 197, 94, 0.1)";
    errorDiv.style.borderColor = "rgba(34, 197, 94, 0.2)";
    errorDiv.style.color = "#22c55e";
  }

  function hideError() { errorDiv.style.display = "none"; }

  function setLoading(loading) {
    btnLogin.disabled = loading;
    btnRegister.disabled = loading;
    btnLogin.classList.toggle("loading", loading);
  }
});
