# Bungae 개발 규칙

## 커밋 메시지 규칙

**모든 커밋 메시지는 반드시 영어로 작성해야 합니다.**

- Conventional Commits 형식 사용: `type: description`
- 타입: `feat`, `fix`, `refactor`, `docs`, `test`, `chore` 등
- 설명: 간결하고 명확하게 작성 (50자 이내 권장)

```bash
# ✅ 올바른 예시
git commit -m "feat: implement Metro-compatible asset handling"
git commit -m "fix: resolve path normalization issue in dev server"

# ❌ 잘못된 예시
git commit -m "feat: Metro 호환 에셋 처리 구현"
```
