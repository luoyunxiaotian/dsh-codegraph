[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$host.UI.RawUI.WindowTitle = "CodeGraph Studio - 0-Token 代码架构与时序图谱工作台"

$root = $PSScriptRoot | Split-Path -Parent
Set-Location $root

$targetDir = if ($args.Count -gt 0 -and $args[0]) { $args[0].Trim('"') } else { $root }
if ($targetDir.EndsWith('\') -or $targetDir.EndsWith('/')) {
    $targetDir = $targetDir.Substring(0, $targetDir.Length - 1)
}

Clear-Host
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  🧭 CodeGraph Studio - 0-Token 代码架构与时序流程图谱系统" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  目标分析目录 : $targetDir" -ForegroundColor White
Write-Host "  本地服务端口 : 3333" -ForegroundColor White
Write-Host "  WebUI 访问地址: http://localhost:3333" -ForegroundColor Yellow
Write-Host "----------------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  [使用技巧]" -ForegroundColor DarkGray
Write-Host "  1. 您可以直接将任意代码文件夹拖拽到 启动CodeGraph.bat 上一键启动分析" -ForegroundColor Gray
Write-Host "  2. 服务启动后将自动为您打开系统默认浏览器进入工作台" -ForegroundColor Gray
Write-Host "  3. 若 3333 端口被占用会自动自愈递增（3334、3335 等）" -ForegroundColor Gray
Write-Host "  4. 在此窗口中按 Ctrl + C 可终止服务" -ForegroundColor Gray
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

try {
    # 1. 检查 Node.js 环境
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "系统未检测到 Node.js 环境！请先安装 Node.js (推荐 v20 或 v22 以上) 并配置 PATH 环境变量。"
    }

    # 2. 检查核心构建产物
    if (-not (Test-Path "$root\packages\core\dist\index.js")) {
        Write-Host "[INFO] 正在编译核心分析引擎..." -ForegroundColor Yellow
        & pnpm --filter @codegraph/core build
        if ($LASTEXITCODE -ne 0) {
            throw "@codegraph/core 构建失败！"
        }
    }

    # 3. 检查前端构建产物
    if (-not (Test-Path "$root\packages\webview\dist\index.html")) {
        Write-Host "[INFO] 正在编译前端可视化界面..." -ForegroundColor Yellow
        & pnpm --filter @codegraph/webview build
        if ($LASTEXITCODE -ne 0) {
            throw "@codegraph/webview 构建失败！"
        }
    }

    Write-Host "[INFO] 正在启动 CodeGraph Studio 服务并唤起浏览器..." -ForegroundColor Green
    Write-Host ""

    # 4. 运行服务 (内置端口自愈与自动唤起浏览器)
    & node "$root\packages\core\dist\cli.js" serve "$targetDir" --port 3333

} catch {
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Red
    Write-Host "  ❌ 启动失败 / 运行时发生异常:" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "======================================================================" -ForegroundColor Red
} finally {
    Write-Host ""
    Write-Host "按任意键退出窗口..." -ForegroundColor DarkGray
    try {
        $null = [Console]::ReadKey($true)
    } catch {
        Read-Host "按回车键退出..."
    }
}
