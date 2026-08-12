function Get-HermesProofChildPath {
  [CmdletBinding()]
  param(
    [AllowEmptyString()]
    [string]$PathValue,
    [string[]]$Prepend = @(),
    [ValidateRange(1024, 8000)]
    [int]$MaxLength = 8000
  )

  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $segments = [Collections.Generic.List[string]]::new()
  foreach ($raw in @($Prepend) + @($PathValue -split ';')) {
    $segment = ([string]$raw).Trim().Trim('"')
    if (-not $segment) { continue }
    $key = $segment.TrimEnd('\')
    if (-not $seen.Add($key)) { continue }
    $candidate = if ($segments.Count) { ($segments -join ';') + ';' + $segment } else { $segment }
    if ($candidate.Length -gt $MaxLength) { continue }
    [void]$segments.Add($segment)
  }
  if (-not $segments.Count) { throw "Cannot construct a safe child PATH" }
  return $segments -join ';'
}
