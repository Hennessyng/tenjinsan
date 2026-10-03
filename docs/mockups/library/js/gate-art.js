;(() => {
  const random = window.TJ.rng(947)
  const flowers = document.getElementById("plum-blossoms")
  const branches = document.querySelectorAll("#plum-branches path")
  const svgNS = "http://www.w3.org/2000/svg"

  for (const [index, branch] of Array.from(branches).entries()) {
    const length = branch.getTotalLength()
    const count = Math.ceil(length / 8)
    for (let n = 0; n < count; n++) {
      const point = branch.getPointAtLength((length * (n + random())) / count)
      const size = 9 + random() * 8
      const flower = document.createElementNS(svgNS, "use")
      flower.setAttribute("href", "#blossom")
      flower.setAttribute("x", String(point.x - size / 2 + random() * 14 - 7))
      flower.setAttribute("y", String(point.y - size / 2 + random() * 14 - 7))
      flower.setAttribute("width", String(size))
      flower.setAttribute("height", String(size))
      flower.style.color = index < 3 ? "var(--shrine-plum-white)" : "var(--shrine-plum)"
      flowers.append(flower)
    }
  }

  const petals = document.getElementById("petals")
  for (let n = 0; n < 24; n++) {
    const petal = document.createElementNS(svgNS, "ellipse")
    petal.setAttribute("cx", String(30 + random() * 500))
    petal.setAttribute("cy", String(480 + random() * 175))
    petal.setAttribute("rx", "2.5")
    petal.setAttribute("ry", "1.4")
    petal.setAttribute("fill", n % 2 ? "var(--shrine-plum)" : "var(--shrine-plum-white)")
    petal.setAttribute("opacity", "0.65")
    petals.append(petal)
  }
})()
