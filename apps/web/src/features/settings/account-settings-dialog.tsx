"use client";

import {
  Camera,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { ACCEPTED_DRAFT_IMAGE_TYPES } from "@/features/capture/attachments";
import {
  readInterfaceTheme,
  storeInterfaceTheme,
  type InterfaceTheme,
} from "@/features/shared/interface-theme";
import type {
  AvatarMediaType,
  CurrentUser,
  DraftImageInput,
  SettingsView,
} from "@/features/shared/contracts";
import { UserAvatar } from "@/features/shared/icons";
import {
  apiErrorMessage,
  readFileAsDataUrl,
  readStoredBoolean,
  storeBoolean,
} from "@/features/shared/utils";
import { api } from "@/lib/api";

const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

export function AccountSettingsDialog({
  initialView = "PROFILE",
  user,
  onClose,
  onUserChange,
  onNotify,
}: {
  initialView?: SettingsView;
  user: CurrentUser;
  onClose: () => void;
  onUserChange: (user: CurrentUser) => void;
  onNotify: (message: string) => void;
}) {
  const [settingsView, setSettingsView] = useState<SettingsView>(initialView);
  const [displayName, setDisplayName] = useState(user.display_name);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatar_url);
  const [avatarUpdate, setAvatarUpdate] = useState<{
    name: string;
    media_type: AvatarMediaType;
    data: string;
  } | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState("");
  const [profileError, setProfileError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [compactInterface, setCompactInterface] = useState(
    () => readStoredBoolean("memora.interface.compact") === true,
  );
  const [reduceMotion, setReduceMotion] = useState(
    () => readStoredBoolean("memora.interface.reduceMotion") === true,
  );
  const [interfaceTheme, setInterfaceTheme] = useState<InterfaceTheme>(readInterfaceTheme);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const normalizedName = displayName.trim().replace(/\s+/g, " ");
  const profileDirty =
    normalizedName !== user.display_name || avatarUpdate !== null || removeAvatar;

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]",
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.classList.add("is-settings-open");
    window.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();
    return () => {
      document.body.classList.remove("is-settings-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED_DRAFT_IMAGE_TYPES.has(file.type as DraftImageInput["media_type"])) {
      setProfileError("头像仅支持 PNG、JPEG 或 WEBP 图片。");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setProfileError("头像不能超过 8 MiB。");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
      setAvatarPreview(dataUrl);
      setAvatarUpdate({
        name: file.name,
        media_type: file.type as AvatarMediaType,
        data: encoded,
      });
      setRemoveAvatar(false);
      setProfileError("");
      setProfileStatus("");
    } catch {
      setProfileError("没有读到这张图片，请重新选择。");
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedName) {
      setProfileError("昵称不能为空。");
      return;
    }
    setProfileSaving(true);
    setProfileError("");
    setProfileStatus("");
    let resolvedUser = user;
    try {
      if (avatarUpdate) {
        const avatarResult = await api.PUT("/auth/avatar", { body: avatarUpdate });
        if (!avatarResult.data || !avatarResult.response.ok) {
          throw new Error(apiErrorMessage(avatarResult.error, "头像保存失败，请稍后重试。"));
        }
        resolvedUser = avatarResult.data;
      } else if (removeAvatar && user.avatar_url) {
        const avatarResult = await api.DELETE("/auth/avatar");
        if (!avatarResult.data || !avatarResult.response.ok) {
          throw new Error(apiErrorMessage(avatarResult.error, "头像移除失败，请稍后重试。"));
        }
        resolvedUser = avatarResult.data;
      }

      if (normalizedName !== resolvedUser.display_name) {
        const profileResult = await api.PATCH("/auth/profile", {
          body: { display_name: normalizedName },
        });
        if (!profileResult.data || !profileResult.response.ok) {
          throw new Error(apiErrorMessage(profileResult.error, "昵称保存失败，请稍后重试。"));
        }
        resolvedUser = profileResult.data;
      }

      onUserChange(resolvedUser);
      setDisplayName(resolvedUser.display_name);
      setAvatarPreview(resolvedUser.avatar_url);
      setAvatarUpdate(null);
      setRemoveAvatar(false);
      setProfileStatus("个人资料已更新");
      onNotify("个人资料已更新");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "个人资料保存失败，请稍后重试。");
    } finally {
      setProfileSaving(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordStatus("");
    if (newPassword.length < 10) {
      setPasswordError("新密码至少需要 10 个字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致。");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("新密码不能与当前密码相同。");
      return;
    }

    setPasswordSaving(true);
    try {
      const result = await api.PUT("/auth/password", {
        body: { current_password: currentPassword, new_password: newPassword },
      });
      if (!result.response.ok) {
        throw new Error(apiErrorMessage(result.error, "密码修改失败，请稍后重试。"));
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordStatus("密码已更新，其他设备上的会话已退出");
      onNotify("密码已更新");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "密码修改失败，请稍后重试。");
    } finally {
      setPasswordSaving(false);
    }
  }

  function openSettingsView(nextView: SettingsView) {
    setSettingsView(nextView);
    setProfileError("");
    setPasswordError("");
  }

  function updateInterfacePreference(preference: "compact" | "reduceMotion", enabled: boolean) {
    if (preference === "compact") {
      setCompactInterface(enabled);
      storeBoolean("memora.interface.compact", enabled);
      document.documentElement.classList.toggle("memora-compact", enabled);
    } else {
      setReduceMotion(enabled);
      storeBoolean("memora.interface.reduceMotion", enabled);
      document.documentElement.classList.toggle("memora-reduce-motion", enabled);
    }
  }

  function updateTheme(theme: InterfaceTheme) {
    setInterfaceTheme(theme);
    storeInterfaceTheme(theme);
  }

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !profileSaving && !passwordSaving) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-header">
          <div>
            <span className="settings-kicker">
              <SettingsIcon aria-hidden="true" size={12} strokeWidth={1.8} />
              ACCOUNT
            </span>
            <h2 id="settings-title">个人设置</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="settings-close"
            type="button"
            aria-label="关闭个人设置"
            title="关闭"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </header>

        <div className="settings-layout">
          <aside className="settings-sidebar">
            <div className="settings-identity">
              <UserAvatar user={user} src={avatarPreview} className="is-large" />
              <div>
                <strong>{normalizedName || user.display_name}</strong>
                <small>{user.email}</small>
              </div>
            </div>
            <div className="settings-tabs" role="tablist" aria-label="设置分类">
              <button
                type="button"
                role="tab"
                aria-selected={settingsView === "INVITATIONS"}
                className={settingsView === "INVITATIONS" ? "is-active" : ""}
                onClick={() => openSettingsView("INVITATIONS")}
              >
                <Mail aria-hidden="true" size={17} strokeWidth={1.8} />
                我的邀请
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsView === "PROFILE"}
                className={settingsView === "PROFILE" ? "is-active" : ""}
                onClick={() => openSettingsView("PROFILE")}
              >
                <UserRound aria-hidden="true" size={17} strokeWidth={1.8} />
                个人资料
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsView === "SECURITY"}
                className={settingsView === "SECURITY" ? "is-active" : ""}
                onClick={() => openSettingsView("SECURITY")}
              >
                <LockKeyhole aria-hidden="true" size={17} strokeWidth={1.8} />
                账号安全
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsView === "GENERAL"}
                className={settingsView === "GENERAL" ? "is-active" : ""}
                onClick={() => openSettingsView("GENERAL")}
              >
                <SlidersHorizontal aria-hidden="true" size={17} strokeWidth={1.8} />
                通用设置
              </button>
            </div>
          </aside>

          <div className="settings-content">
            {settingsView === "PROFILE" ? (
              <form
                className="settings-form"
                role="tabpanel"
                aria-label="个人资料"
                onSubmit={saveProfile}
              >
                <div className="settings-section-heading">
                  <h3>个人资料</h3>
                  <p>头像和昵称会显示在你的个人工作台中。</p>
                </div>
                <div className="avatar-editor">
                  <div className="avatar-preview-wrap">
                    <UserAvatar user={user} src={avatarPreview} className="is-editor" />
                    <button
                      type="button"
                      aria-label="选择新头像"
                      title="选择新头像"
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <Camera aria-hidden="true" size={17} strokeWidth={1.8} />
                    </button>
                  </div>
                  <div>
                    <input
                      ref={avatarInputRef}
                      className="image-input"
                      type="file"
                      aria-label="选择头像图片"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void chooseAvatar(event)}
                    />
                    <div className="avatar-actions">
                      <button type="button" onClick={() => avatarInputRef.current?.click()}>
                        <Upload aria-hidden="true" size={15} strokeWidth={1.8} />
                        更换头像
                      </button>
                      {(avatarPreview || avatarUpdate) && (
                        <button
                          className="is-danger"
                          type="button"
                          aria-label="移除头像"
                          title="移除头像"
                          onClick={() => {
                            setAvatarPreview(null);
                            setAvatarUpdate(null);
                            setRemoveAvatar(true);
                            setProfileStatus("");
                          }}
                        >
                          <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
                        </button>
                      )}
                    </div>
                    <small>PNG、JPEG 或 WEBP，最大 8 MiB</small>
                  </div>
                </div>
                <label className="settings-field" htmlFor="profile-display-name">
                  <span>昵称</span>
                  <input
                    id="profile-display-name"
                    value={displayName}
                    maxLength={120}
                    autoComplete="nickname"
                    onChange={(event) => {
                      setDisplayName(event.target.value);
                      setProfileError("");
                      setProfileStatus("");
                    }}
                  />
                </label>
                <label className="settings-field" htmlFor="profile-email">
                  <span>登录邮箱</span>
                  <input id="profile-email" value={user.email} readOnly />
                </label>
                <div className="settings-form-footer">
                  <span
                    className={profileError ? "settings-feedback is-error" : "settings-feedback"}
                    role={profileError ? "alert" : "status"}
                  >
                    {profileError || profileStatus}
                  </span>
                  <button
                    className="settings-save"
                    type="submit"
                    disabled={!profileDirty || profileSaving}
                  >
                    {profileSaving ? (
                      "正在保存…"
                    ) : (
                      <>
                        <Check aria-hidden="true" size={15} strokeWidth={2} />
                        保存更改
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : settingsView === "SECURITY" ? (
              <form
                className="settings-form"
                role="tabpanel"
                aria-label="账号安全"
                onSubmit={savePassword}
              >
                <div className="settings-section-heading">
                  <h3>账号安全</h3>
                  <p>更新后，当前设备会保持登录。</p>
                </div>
                {[
                  ["current-password", "当前密码", currentPassword, setCurrentPassword],
                  ["new-password", "新密码", newPassword, setNewPassword],
                  ["confirm-password", "确认新密码", confirmPassword, setConfirmPassword],
                ].map(([id, label, value, setter]) => (
                  <label className="settings-field" htmlFor={id as string} key={id as string}>
                    <span>{label as string}</span>
                    <span className="password-input-wrap">
                      <input
                        id={id as string}
                        type={passwordVisible ? "text" : "password"}
                        value={value as string}
                        minLength={id === "current-password" ? 1 : 10}
                        maxLength={128}
                        autoComplete={
                          id === "current-password" ? "current-password" : "new-password"
                        }
                        onChange={(event) => {
                          (setter as (value: string) => void)(event.target.value);
                          setPasswordError("");
                          setPasswordStatus("");
                        }}
                        required
                      />
                      <button
                        type="button"
                        aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                        title={passwordVisible ? "隐藏密码" : "显示密码"}
                        onClick={() => setPasswordVisible((visible) => !visible)}
                      >
                        {passwordVisible ? (
                          <EyeOff aria-hidden="true" size={16} strokeWidth={1.8} />
                        ) : (
                          <Eye aria-hidden="true" size={16} strokeWidth={1.8} />
                        )}
                      </button>
                    </span>
                  </label>
                ))}
                <div className="password-meter" aria-hidden="true">
                  <span className={newPassword.length >= 10 ? "is-filled" : ""} />
                  <span className={newPassword.length >= 14 ? "is-filled" : ""} />
                  <span
                    className={
                      /[A-Za-z]/.test(newPassword) && /\d/.test(newPassword) ? "is-filled" : ""
                    }
                  />
                </div>
                <div className="settings-form-footer">
                  <span
                    className={passwordError ? "settings-feedback is-error" : "settings-feedback"}
                    role={passwordError ? "alert" : "status"}
                  >
                    {passwordError || passwordStatus}
                  </span>
                  <button
                    className="settings-save"
                    type="submit"
                    disabled={
                      passwordSaving || !currentPassword || !newPassword || !confirmPassword
                    }
                  >
                    {passwordSaving ? (
                      "正在更新…"
                    ) : (
                      <>
                        <LockKeyhole aria-hidden="true" size={15} strokeWidth={1.8} />
                        更新密码
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : settingsView === "INVITATIONS" ? (
              <section className="settings-form" role="tabpanel" aria-label="我的邀请">
                <div className="settings-section-heading">
                  <h3>我的邀请</h3>
                  <p>团队邀请和加入申请会集中显示在这里。</p>
                </div>
                <div className="settings-empty-state">
                  <span>
                    <Mail aria-hidden="true" size={22} strokeWidth={1.6} />
                  </span>
                  <strong>暂无待处理邀请</strong>
                  <p>收到团队邀请后，你可以在这里查看组织信息并决定是否加入。</p>
                </div>
                <div className="settings-info-list" aria-label="邀请说明">
                  <div>
                    <span>使用团队号</span>
                    <small>也可以在空间菜单中提交加入申请</small>
                  </div>
                  <div>
                    <span>隐私边界</span>
                    <small>加入团队不会自动公开你的个人记忆</small>
                  </div>
                </div>
              </section>
            ) : (
              <section className="settings-form" role="tabpanel" aria-label="通用设置">
                <div className="settings-section-heading">
                  <h3>通用设置</h3>
                  <p>这些偏好只保存在当前浏览器，不会改变团队中的其他成员。</p>
                </div>
                <fieldset className="settings-theme-fieldset">
                  <legend>外观主题</legend>
                  <div className="settings-theme-picker" role="radiogroup" aria-label="外观主题">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={interfaceTheme === "dark"}
                      className={interfaceTheme === "dark" ? "is-selected" : ""}
                      onClick={() => updateTheme("dark")}
                    >
                      <span className="settings-theme-swatch is-dark" aria-hidden="true" />
                      <span>
                        <strong>黑色</strong>
                        <small>深色背景</small>
                      </span>
                      {interfaceTheme === "dark" ? (
                        <Check aria-hidden="true" size={14} strokeWidth={2} />
                      ) : null}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={interfaceTheme === "light"}
                      className={interfaceTheme === "light" ? "is-selected" : ""}
                      onClick={() => updateTheme("light")}
                    >
                      <span className="settings-theme-swatch is-light" aria-hidden="true" />
                      <span>
                        <strong>白色</strong>
                        <small>浅色背景</small>
                      </span>
                      {interfaceTheme === "light" ? (
                        <Check aria-hidden="true" size={14} strokeWidth={2} />
                      ) : null}
                    </button>
                  </div>
                </fieldset>
                <div className="settings-toggle-list">
                  <label>
                    <span>
                      <strong>紧凑界面</strong>
                      <small>减少侧栏和工具区的留白，显示更多内容</small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="紧凑界面"
                      checked={compactInterface}
                      onChange={(event) =>
                        updateInterfacePreference("compact", event.target.checked)
                      }
                    />
                  </label>
                  <label>
                    <span>
                      <strong>减少动态效果</strong>
                      <small>关闭非必要的位移、缩放和淡入动画</small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="减少动态效果"
                      checked={reduceMotion}
                      onChange={(event) =>
                        updateInterfacePreference("reduceMotion", event.target.checked)
                      }
                    />
                  </label>
                </div>
                <p className="settings-local-note">更改会立即生效，并在下次打开 Memora 时恢复。</p>
              </section>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
